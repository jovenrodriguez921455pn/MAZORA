/* MAZORA Cloud Library
   Manual EPUB/PDF upload only.
   Local IndexedDB files are never modified or deleted.
*/
(function () {
  "use strict";

  let panel = null;
  let selected = new Set();
  let books = [];
  let busy = false;

  const $ = id => document.getElementById(id);

  function showCloudNotice(titleText, messageText) {
    const existing = $("mazoraCloudNotice");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "mazoraCloudNotice";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "100001",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "22px",
      background: "rgba(38,20,35,.58)",
      backdropFilter: "blur(4px)"
    });

    const dialog = document.createElement("div");
    Object.assign(dialog.style, {
      width: "100%",
      maxWidth: "390px",
      padding: "26px 22px",
      borderRadius: "24px",
      background: "#fffdf9",
      color: "#402039",
      boxShadow: "0 18px 60px rgba(0,0,0,.25)",
      textAlign: "center",
      fontFamily: "inherit"
    });

    const icon = document.createElement("div");
    icon.textContent = "!";
    Object.assign(icon.style, {
      width: "58px",
      height: "58px",
      margin: "0 auto 16px",
      border: "3px solid #c94a4a",
      borderRadius: "50%",
      color: "#c94a4a",
      fontSize: "38px",
      lineHeight: "52px",
      fontWeight: "700"
    });

    const heading = document.createElement("h3");
    heading.textContent = titleText;
    Object.assign(heading.style, {
      margin: "0 0 12px",
      fontSize: "22px",
      color: "#281b27"
    });

    const message = document.createElement("p");
    message.textContent = messageText;
    Object.assign(message.style, {
      margin: "0 0 22px",
      fontSize: "15px",
      lineHeight: "1.6",
      color: "#625663",
      overflowWrap: "anywhere"
    });

    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "OK";
    Object.assign(ok.style, {
      width: "100%",
      minHeight: "49px",
      border: "0",
      borderRadius: "25px",
      background: "#512747",
      color: "#fff",
      fontSize: "16px",
      fontWeight: "700",
      cursor: "pointer"
    });

    function close() {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    }
    function onKey(event) {
      if (event.key === "Escape") close();
    }

    ok.addEventListener("click", close);
    overlay.addEventListener("click", event => {
      if (event.target === overlay) close();
    });

    dialog.append(icon, heading, message, ok);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
    ok.focus();
  }

  function status(message, error) {
    const box = $("mazoraCloudStatus");
    if (!box) return;

    if (error) {
      box.textContent = "";
      showCloudNotice("Upload Failed", message);
      return;
    }

    box.textContent = message;
    box.style.color = "inherit";
  }

  function getClient() {
    if (typeof window.mazoraGetSupabaseClient !== "function") {
      return null;
    }
    return window.mazoraGetSupabaseClient();
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return "Unknown size";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(2) + " MB";
  }

  function safeFilename(name) {
    return String(name || "book")
      .replace(/[\/\\]/g, "_")
      .replace(/[^\w.\- ()]/g, "_")
      .slice(0, 150);
  }

  function makePanel() {
    if ($("mazoraCloudPanel")) return;

    const input = $("readerFileInput");
    if (!input) return;

    const style = document.createElement("style");
    style.id = "mazora-cloud-library-style";
    style.textContent = `
      #mazoraCloudPanel {
        margin: 18px 0 24px;
        padding: 18px;
        border: 1px solid var(--line, #ded6dc);
        border-radius: 16px;
        background: var(--card, #fff);
      }
      #mazoraCloudPanel h2 {
        margin: 0 0 7px;
        font-size: 19px;
      }
      #mazoraCloudPanel .cloud-intro {
        margin: 0 0 14px;
        font-size: 13px;
        line-height: 1.5;
        opacity: .75;
      }
      #mazoraCloudPanel .cloud-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 9px;
        margin: 12px 0;
      }
      #mazoraCloudPanel .cloud-book-list {
        display: grid;
        gap: 8px;
        margin: 12px 0;
        max-height: 340px;
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
        scrollbar-color: #98758f #f3edf2;
        padding-right: 5px;
      }

      #mazoraCloudPanel .cloud-book-list::-webkit-scrollbar {
        width: 6px;
      }

      #mazoraCloudPanel .cloud-book-list::-webkit-scrollbar-track {
        background: #f3edf2;
        border-radius: 10px;
      }

      #mazoraCloudPanel .cloud-book-list::-webkit-scrollbar-thumb {
        background: #98758f;
        border-radius: 10px;
      }

      #mazoraCloudPanel .cloud-select-all {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        margin-bottom: 3px;
        background: var(--card, #fff);
        border: 1px solid var(--line, #ded6dc);
        border-radius: 10px;
        font-weight: 700;
      }

      #mazoraCloudPanel .cloud-select-all input {
        width: 20px;
        height: 20px;
        flex: 0 0 auto;
      }
      #mazoraCloudPanel .cloud-book-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        border: 1px solid var(--line, #ded6dc);
        border-radius: 10px;
      }
      #mazoraCloudPanel .cloud-book-row input {
        width: 18px;
        height: 18px;
        flex: 0 0 auto;
      }
      #mazoraCloudPanel .cloud-book-info {
        min-width: 0;
        flex: 1;
      }
      #mazoraCloudPanel .cloud-book-title {
        display: block;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      #mazoraCloudPanel .cloud-book-meta {
        display: block;
        margin-top: 3px;
        font-size: 12px;
        opacity: .7;
      }
      #mazoraCloudStatus {
        min-height: 20px;
        margin-top: 10px;
        font-size: 13px;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }
      #mazoraCloudUpload:disabled {
        opacity: .5;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);

    panel = document.createElement("section");
    panel.id = "mazoraCloudPanel";
    panel.innerHTML = `
      <h2>☁ MAZORA Cloud Library</h2>
      <p class="cloud-intro">
        Select books already imported on this device and upload them
        to your private MAZORA account. Nothing uploads automatically.
        Your local books remain on this device.
      </p>
      <div class="cloud-actions">
        <button type="button" class="action secondary" id="mazoraCloudRefresh">
          Select local books
        </button>
        <button type="button" class="action" id="mazoraCloudUpload" disabled>
          Upload selected books
        </button>
      </div>
      <div id="mazoraCloudBookList" class="cloud-book-list">
        <p class="cloud-intro">Choose “Select local books” to begin.</p>
      </div>
      <div id="mazoraCloudStatus" role="status" aria-live="polite"></div>
    `;

    input.insertAdjacentElement("afterend", panel);

    const localList = $("mazoraCloudBookList");
    const selectButton = $("mazoraCloudRefresh");
    const uploadButton = $("mazoraCloudUpload");

    selectButton.addEventListener("click", () => {
      if (localList.dataset.loaded === "true") {
        localList.style.display =
          localList.style.display === "none" ? "grid" : "none";
        return;
      }
      loadLocalBooks();
    });

    uploadButton.addEventListener("click", uploadSelected);

    document.addEventListener("pointerdown", event => {
      if (
        localList.dataset.loaded === "true" &&
        localList.style.display !== "none" &&
        !localList.contains(event.target) &&
        !selectButton.contains(event.target) &&
        !uploadButton.contains(event.target)
      ) {
        localList.style.display = "none";
      }
    });
  }

  function updateUploadButton() {
    const button = $("mazoraCloudUpload");
    if (button) {
      button.disabled = busy || selected.size === 0;
      button.textContent = busy
        ? "Uploading…"
        : "Upload selected books (" + selected.size + ")";
    }
  }

  async function loadLocalBooks() {
    if (busy) return;

    const client = getClient();
    if (!client) {
      status("Account service is not ready. Refresh MAZORA and try again.", true);
      return;
    }

    try {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;

      if (!data?.user) {
        status("Please sign in to use MAZORA Cloud Library.", true);
        return;
      }

      await window.openDatabase();

      const localBooks = await window.getAllBooks();
      books = [];

      for (const book of localBooks) {
        if (!book.readerFileId) continue;

        const record = await window.getReaderFile(book.readerFileId);
        if (!record?.blob) continue;

        const type = String(book.fileType || record.type || "").toLowerCase();
        if (type !== "epub" && type !== "pdf") continue;

        books.push({
          book,
          record,
          type,
          size: record.blob.size || 0
        });
      }

      selected.clear();
      renderBookList();

      const localList = $("mazoraCloudBookList");
      if (localList) {
        localList.dataset.loaded = "true";
        localList.style.display = "grid";
      }

      if (!books.length) {
        status("No locally imported EPUB or PDF books were found.", false);
      } else {
        status(
          books.length + " local book(s) found. Select the books you want to upload.",
          false
        );
      }
    } catch (error) {
      console.error("MAZORA cloud list error:", error);
      status("Could not read your local books: " + (error.message || error), true);
    }
  }

  function renderBookList() {
    const list = $("mazoraCloudBookList");
    if (!list) return;

    list.replaceChildren();

    if (!books.length) {
      const empty = document.createElement("p");
      empty.className = "cloud-intro";
      empty.textContent = "No eligible local EPUB/PDF books found.";
      list.appendChild(empty);
      updateUploadButton();
      return;
    }

    // Select-all control stays visible while scrolling the book list.
    const selectAllRow = document.createElement("label");
    selectAllRow.className = "cloud-select-all";

    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.id = "mazoraCloudSelectAll";
    selectAll.checked = selected.size === books.length;

    const selectAllText = document.createElement("span");
    selectAllText.textContent = "Select all (" + books.length + " books)";

    selectAll.addEventListener("change", () => {
      selected.clear();

      if (selectAll.checked) {
        books.forEach((item, index) => selected.add(index));
      }

      renderBookList();
    });

    selectAllRow.append(selectAll, selectAllText);
    list.appendChild(selectAllRow);

    books.forEach((item, index) => {
      const row = document.createElement("label");
      row.className = "cloud-book-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(index);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(index);
        else selected.delete(index);

        const allBox = $("mazoraCloudSelectAll");
        if (allBox) {
          allBox.checked = selected.size === books.length;
          allBox.indeterminate =
            selected.size > 0 && selected.size < books.length;
        }

        updateUploadButton();
      });

      const info = document.createElement("span");
      info.className = "cloud-book-info";

      const title = document.createElement("span");
      title.className = "cloud-book-title";
      title.textContent = item.book.title || item.record.name || "Untitled book";

      const meta = document.createElement("span");
      meta.className = "cloud-book-meta";
      meta.textContent =
        (item.book.author || "Unknown author") + " · " +
        item.type.toUpperCase() + " · " + formatSize(item.size);

      info.append(title, meta);
      row.append(checkbox, info);
      list.appendChild(row);
    });

    updateUploadButton();
  }


  function showUploadConfirmation(chosen, totalBytes) {
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "100000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        background: "rgba(38, 20, 35, .68)",
        backdropFilter: "blur(5px)"
      });

      const dialog = document.createElement("div");
      Object.assign(dialog.style, {
        width: "100%",
        maxWidth: "440px",
        maxHeight: "85vh",
        overflowY: "auto",
        padding: "25px",
        borderRadius: "24px",
        background: "#fffdf9",
        color: "#402039",
        boxShadow: "0 20px 70px rgba(0,0,0,.28)",
        fontFamily: "inherit"
      });

      const header = document.createElement("div");
      header.style.cssText =
        "display:flex;align-items:center;gap:13px;margin-bottom:20px";

      const icon = document.createElement("div");
      icon.textContent = "☁";
      icon.style.cssText =
        "width:52px;height:52px;border-radius:17px;" +
        "display:grid;place-items:center;background:#f3e8f0;" +
        "color:#512747;font-size:28px;flex-shrink:0";

      const heading = document.createElement("div");
      const brand = document.createElement("div");
      brand.textContent = "MAZORA CLOUD";
      brand.style.cssText =
        "font-size:11px;letter-spacing:2px;font-weight:700;color:#98788f";

      const title = document.createElement("div");
      title.textContent = "Upload your books?";
      title.style.cssText =
        "font-family:Georgia,serif;font-size:23px;font-weight:600;margin-top:4px";

      heading.append(brand, title);
      header.append(icon, heading);

      const intro = document.createElement("p");
      intro.textContent =
        "You're about to add these selected books to your private cloud library.";
      intro.style.cssText =
        "font-size:14px;line-height:1.55;color:#776b75;margin:0 0 17px";

      const summary = document.createElement("div");
      summary.style.cssText =
        "display:flex;justify-content:space-between;align-items:center;" +
        "padding:13px 15px;background:#f5eef3;border-radius:13px;margin-bottom:12px";

      const count = document.createElement("strong");
      count.textContent = chosen.length + " selected book(s)";
      count.style.fontSize = "13px";

      const total = document.createElement("strong");
      total.textContent = formatSize(totalBytes);
      total.style.fontSize = "13px";

      summary.append(count, total);

      const list = document.createElement("div");
      list.style.cssText =
        "display:grid;gap:8px;max-height:210px;overflow-y:auto;margin-bottom:16px";

      chosen.forEach(item => {
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;justify-content:space-between;align-items:center;" +
          "gap:12px;padding:12px;border:1px solid #eadfe7;border-radius:12px";

        const name = document.createElement("span");
        name.textContent = item.book.title || item.record.name || "Untitled book";
        name.style.cssText =
          "font-size:13px;font-weight:600;overflow-wrap:anywhere;flex:1";

        const size = document.createElement("span");
        size.textContent = formatSize(item.size);
        size.style.cssText =
          "font-size:12px;color:#887985;white-space:nowrap";

        row.append(name, size);
        list.appendChild(row);
      });

      const notice = document.createElement("div");
      notice.textContent =
        "✓ Your local copies will remain unchanged. Only the selected files will be uploaded to your private MAZORA account.";
      notice.style.cssText =
        "padding:13px;background:#f0f5ed;color:#536b4c;" +
        "border-radius:12px;font-size:12px;line-height:1.55;margin-bottom:20px";

      const actions = document.createElement("div");
      actions.style.cssText =
        "display:flex;gap:10px";

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";

      const upload = document.createElement("button");
      upload.type = "button";
      upload.textContent = "Upload to Cloud";

      [cancel, upload].forEach(button => {
        button.style.cssText =
          "flex:1;min-height:49px;border-radius:14px;" +
          "font-size:14px;font-weight:700;cursor:pointer;padding:10px";
      });

      cancel.style.background = "#fffdf9";
      cancel.style.color = "#512747";
      cancel.style.border = "1px solid #d8c8d3";

      upload.style.background = "#48213f";
      upload.style.color = "#ffffff";
      upload.style.border = "1px solid #48213f";

      function finish(value) {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(value);
      }

      function onKey(event) {
        if (event.key === "Escape") finish(false);
      }

      cancel.addEventListener("click", () => finish(false));
      upload.addEventListener("click", () => finish(true));
      overlay.addEventListener("click", event => {
        if (event.target === overlay) finish(false);
      });

      actions.append(cancel, upload);
      dialog.append(header, intro, summary, list, notice, actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      document.addEventListener("keydown", onKey);
    });
  }


  async function calculateFileHash(blob) {
    if (!crypto.subtle) {
      throw new Error("Secure file hashing is unavailable in this browser.");
    }
    const bytes = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map(value => value.toString(16).padStart(2, "0"))
      .join("");
  }

  async function findCloudDuplicate(client, userId, hash) {
    const { data, error } = await client
      .from("mazora_library_books")
      .select("id,title,file_path,file_hash")
      .eq("user_id", userId);

    if (error) throw error;

    for (const record of (data || [])) {
      let existingHash = record.file_hash;

      // Backfill older cloud records that predate file_hash.
      if (!existingHash && record.file_path) {
        const { data: blob, error: downloadError } = await client.storage
          .from("mazora-books")
          .download(record.file_path);

        if (downloadError) {
          console.warn("Could not fingerprint older cloud file:", downloadError);
          continue;
        }

        existingHash = await calculateFileHash(blob);

        const { error: updateError } = await client
          .from("mazora_library_books")
          .update({ file_hash: existingHash })
          .eq("id", record.id)
          .eq("user_id", userId);

        if (updateError) throw updateError;
      }

      if (existingHash && existingHash === hash) {
        return record;
      }
    }

    return null;
  }

  async function uploadSelected() {
    if (busy || selected.size === 0) return;

    const client = getClient();
    if (!client) {
      status("Account service is not ready. Please refresh MAZORA.", true);
      return;
    }

    let user;

    try {
      const result = await client.auth.getUser();
      if (result.error) throw result.error;
      user = result.data?.user;
    } catch (error) {
      status("Could not verify your account: " + error.message, true);
      return;
    }

    if (!user) {
      status("Please sign in before uploading books.", true);
      return;
    }

    const chosen = [...selected]
      .map(index => books[index])
      .filter(Boolean);

    const totalBytes = chosen.reduce(
      (sum, item) => sum + item.size, 0
    );

    const confirmed = await showUploadConfirmation(chosen, totalBytes);
    if (!confirmed) return;

    busy = true;
    updateUploadButton();
    status("Preparing your selected books…", false);

    let succeeded = 0;
    const failures = [];
    const skipped = [];

    try {
      for (const item of chosen) {
        let storagePath = null;

        try {
          const fileHash = await calculateFileHash(item.record.blob);
          const duplicate = await findCloudDuplicate(client, user.id, fileHash);

          if (duplicate) {
            skipped.push(
              (item.book.title || "Untitled book") +
              " matches an existing cloud file: " +
              (duplicate.title || "Untitled book")
            );
            books = books.filter(candidate => candidate !== item);
            continue;
          }

          const bookUuid = crypto.randomUUID();
          const filename = safeFilename(
            item.record.name ||
            (item.book.title || "book") + "." + item.type
          );

          storagePath =
            user.id + "/" + bookUuid + "/" + filename;

          const contentType = item.type === "pdf"
            ? "application/pdf"
            : "application/epub+zip";

          status(
            "Uploading " + (item.book.title || filename) + "…",
            false
          );

          const { error: uploadError } =
            await client.storage
              .from("mazora-books")
              .upload(storagePath, item.record.blob, {
                contentType,
                upsert: false
              });

          if (uploadError) throw uploadError;

          const metadata = {
            user_id: user.id,
            title: item.book.title || filename,
            author: item.book.author || "Unknown author",
            description: null,
            cover_url: item.book.cover || null,
            file_path: storagePath,
            file_type: item.type,
            file_hash: fileHash
          };

          const { error: insertError } =
            await client
              .from("mazora_library_books")
              .insert(metadata);

          if (insertError) {
            // Remove the uploaded object if its metadata could not be saved.
            const { error: cleanupError } =
              await client.storage
                .from("mazora-books")
                .remove([storagePath]);

            if (cleanupError) {
              console.error(
                "MAZORA cloud cleanup error:",
                cleanupError
              );
            }

            throw insertError;
          }

          succeeded++;

          // Hide successfully uploaded books from the upload selection list.
          books = books.filter(candidate => candidate !== item);

        } catch (error) {
          console.error("MAZORA book upload error:", error);

          const errorText = String(error.message || error);
          const isDuplicate =
            error.code === "23505" ||
            errorText.includes("mazora_library_books_user_file_hash_unique");

          if (isDuplicate) {
            skipped.push(
              (item.book.title || "Untitled book") +
              " is already stored in your cloud library."
            );
            books = books.filter(candidate => candidate !== item);
          } else {
            failures.push(
              (item.book.title || "Untitled book") +
              ": " + errorText
            );
          }
        }
      }

      selected.clear();
      renderBookList();

      const parts = [];
      if (succeeded) parts.push(succeeded + " uploaded successfully");
      if (skipped.length) parts.push(skipped.length + " duplicate(s) skipped");
      if (failures.length) parts.push(failures.length + " failed");

      const details = [];
      if (skipped.length) {
        details.push("Duplicate files were skipped: " + skipped.join(" "));
      }
      if (failures.length) {
        details.push("Some uploads could not be completed: " + failures.join(" "));
      }

      if (details.length) {
        status(
          details.join("\n\n") + "\n\nYour local copies are unchanged.",
          true
        );
      } else if (succeeded) {
        status(succeeded + " book(s) uploaded successfully. Local copies are unchanged.", false);
      } else {
        status("No books were uploaded. Your local copies are unchanged.", false);
      }

    } finally {
      busy = false;
      updateUploadButton();
    }
  }

  function init() {
    makePanel();

    if (!panel) {
      console.warn("MAZORA Cloud Library: My Library upload input not found.");
      return;
    }

    if (window.MAZORA_AUTH_SIGNED_IN) {
      status("Signed-in account detected. Select local books to begin.", false);
    } else {
      status("Sign in to use private cloud uploads. Local books remain on this device.", false);
    }
  }

  window.mazoraCloudRefresh = loadLocalBooks;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
