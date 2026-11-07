/* MAZORA Cloud Library Sync
   Private cloud listing and download to local IndexedDB.
   Does not modify or delete existing local books.
*/
(function () {
  "use strict";

  const BUCKET = "mazora-books";
  let panel;
  let busy = false;
  let cachedCloudBooks = [];
  let selectedCloudIds = new Set();
  let cloudDownloadButtons = new Map();
  let bulkDownloading = false;

  const $ = id => document.getElementById(id);

  function getClient() {
    return typeof window.mazoraGetSupabaseClient === "function"
      ? window.mazoraGetSupabaseClient()
      : null;
  }

  function message(text, error = false) {
    const el = $("mazoraSyncStatus");
    if (!el) return;
    el.textContent = text;
    el.style.color = error ? "#b94a48" : "inherit";
  }

  function createPanel() {
    if ($("mazoraCloudSyncPanel")) return;

    const anchor = $("mazoraCloudPanel");
    if (!anchor) return;

    const style = document.createElement("style");
    style.textContent = `
      #mazoraCloudSyncPanel {
        margin: 18px 0 24px;
        padding: 18px;
        border: 1px solid var(--line, #ded6dc);
        border-radius: 16px;
        background: var(--card, #fff);
      }
      #mazoraCloudSyncPanel h2 {
        margin: 0 0 7px;
        font-size: 19px;
      }
      #mazoraCloudSyncPanel .sync-intro {
        font-size: 13px;
        line-height: 1.5;
        opacity: .75;
      }
      #mazoraCloudSyncPanel .sync-book {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 0;
        border-bottom: 1px solid var(--line, #ded6dc);
      }
      #mazoraCloudSyncPanel .sync-book-info {
        flex: 1;
        min-width: 0;
      }
      #mazoraCloudSyncPanel .sync-book-title {
        display: block;
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      #mazoraCloudSyncPanel .sync-book-meta {
        display: block;
        margin-top: 4px;
        font-size: 12px;
        opacity: .7;
      }
      #mazoraCloudSyncPanel .sync-download {
        flex: 0 0 auto;
      }
      #mazoraCloudToolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 12px 0;
      }
      #mazoraCloudSearchBar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 7px;
        min-width: 40px;
      }
      #mazoraCloudSearchInput {
        width: min(48vw, 220px);
        min-width: 0;
        padding: 10px 12px;
        border: 1px solid var(--line, #ded6dc);
        border-radius: 10px;
        background: var(--card, #fff);
        color: inherit;
        font: inherit;
      }
      #mazoraCloudSearchToggle,
      #mazoraCloudSearchClose {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        padding: 0;
        border: 0 !important;
        outline: none;
        box-shadow: none !important;
        border-radius: 0 !important;
        background: transparent !important;
        color: #512747;
        font-size: 27px;
        cursor: pointer;
      }
      #mazoraCloudSearchToggle:focus,
      #mazoraCloudSearchClose:focus {
        outline: none;
        box-shadow: none;
      }
      @media (max-width: 380px) {
        #mazoraCloudToolbar { gap: 6px; }
        #mazoraCloudToolbar #mazoraSyncRefresh {
          padding-left: 12px;
          padding-right: 12px;
          font-size: 13px;
        }
      }
      /* Compact cloud book list with independent vertical scrolling */
      #mazoraSyncBooks {
        max-height: 380px;
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
        scrollbar-color: #98758f #f3edf2;
        padding-right: 5px;
      }

      #mazoraSyncBooks::-webkit-scrollbar {
        width: 6px;
      }

      #mazoraSyncBooks::-webkit-scrollbar-track {
        background: #f3edf2;
        border-radius: 10px;
      }

      #mazoraSyncBooks::-webkit-scrollbar-thumb {
        background: #98758f;
        border-radius: 10px;
      }

      #mazoraSyncStatus {
        min-height: 20px;
        margin-top: 12px;
        font-size: 13px;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }
    `;
    document.head.appendChild(style);

    panel = document.createElement("section");
    panel.id = "mazoraCloudSyncPanel";
    panel.innerHTML = `
      <h2>☁ My Cloud Library</h2>
      <p class="sync-intro">
        Books stored in your private MAZORA account.
        Download a book to this device to read it offline.
      </p>
      <div id="mazoraCloudToolbar">
        <button type="button" class="action secondary" id="mazoraSyncRefresh">
          Refresh cloud books
        </button>
        <div id="mazoraCloudSearchBar">
          <button type="button" id="mazoraCloudSearchToggle" aria-label="Search cloud books" title="Search cloud books">⌕</button>
          <input id="mazoraCloudSearchInput" type="search" placeholder="Search title or author..." aria-label="Search cloud books" style="display:none;">
          <button type="button" id="mazoraCloudSearchClose" aria-label="Close search" title="Close search" style="display:none;">×</button>
        </div>
      </div>
      <div id="mazoraSyncBooks" aria-live="polite">
        <p class="sync-intro">Tap Refresh cloud books to load your books.</p>
      </div>
      <div id="mazoraSyncStatus" role="status" aria-live="polite"></div>
    `;

    anchor.insertAdjacentElement("afterend", panel);
    $("mazoraSyncRefresh").addEventListener("click", loadCloudBooks);

    $("mazoraCloudSearchToggle").addEventListener("click", () => {
      $("mazoraCloudSearchInput").style.display = "block";
      $("mazoraCloudSearchToggle").style.display = "none";
      $("mazoraCloudSearchClose").style.display = "inline-flex";
      $("mazoraCloudSearchInput").focus();
    });

    function closeCloudSearch(clearSearch) {
      const input = $("mazoraCloudSearchInput");
      if (!input) return;

      if (clearSearch) input.value = "";

      input.style.display = "none";
      $("mazoraCloudSearchToggle").style.display = "inline-flex";
      $("mazoraCloudSearchClose").style.display = "none";

      renderCloudBooks(cachedCloudBooks);
    }

    const cloudSearchInput = $("mazoraCloudSearchInput");
    const cloudSearchBar = $("mazoraCloudSearchBar");

    cloudSearchInput.addEventListener("input", () => {
      renderCloudBooks(cachedCloudBooks);

      if (!cloudSearchInput.value.trim()) {
        closeCloudSearch(false);
      }
    });

    cloudSearchInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        closeCloudSearch(false);
        cloudSearchInput.blur();
      }
    });

    // Close only when the user taps outside the cloud search controls.
    document.addEventListener("click", event => {
      if (
        cloudSearchInput.style.display !== "none" &&
        cloudSearchBar &&
        !cloudSearchBar.contains(event.target)
      ) {
        closeCloudSearch(false);
        cloudSearchInput.blur();
      }
    });

    $("mazoraCloudSearchClose").addEventListener("click", () => {
      closeCloudSearch(true);
    });

    // Collapse the cloud book list when tapping outside it.
    const cloudList = $("mazoraSyncBooks");
    const cloudToolbar = $("mazoraCloudToolbar");

    document.addEventListener("pointerdown", event => {
      if (
        cloudList &&
        cloudList.dataset.loaded === "true" &&
        cloudList.style.display !== "none" &&
        !cloudList.contains(event.target) &&
        !cloudToolbar.contains(event.target)
      ) {
        cloudList.style.display = "none";
      }
    });
  }

  async function loadCloudBooks() {
    if (busy) return;

    const client = getClient();
    if (!client) {
      message("Account service is not ready. Refresh MAZORA.", true);
      return;
    }

    message("Loading your private cloud books…");

    try {
      const { data: authData, error: authError } =
        await client.auth.getUser();

      if (authError) throw authError;
      if (!authData?.user) {
        message("Please sign in to view your cloud library.", true);
        return;
      }

      const { data, error } = await client
        .from("mazora_library_books")
        .select("id,title,author,cover_url,file_path,file_type,created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;

      renderCloudBooks(data || []);
      const cloudList = $("mazoraSyncBooks");
      if (cloudList) {
        cloudList.dataset.loaded = "true";
        cloudList.style.display = "block";
      }
      message((data || []).length + " cloud book(s) found.");
    } catch (error) {
      console.error("MAZORA cloud listing error:", error);
      message("Could not load cloud books: " +
        (error.message || String(error)), true);
    }
  }

  async function renderCloudBooks(cloudBooks) {
    cachedCloudBooks = Array.isArray(cloudBooks) ? cloudBooks : [];
    const query = ($("mazoraCloudSearchInput")?.value || "").trim().toLowerCase();

    cloudBooks = cachedCloudBooks.filter(book =>
      String(book.title || "").toLowerCase().includes(query) ||
      String(book.author || "").toLowerCase().includes(query) ||
      String(book.file_type || "").toLowerCase().includes(query)
    );

    const list = $("mazoraSyncBooks");
    if (!list) return;

    list.replaceChildren();

    if (!cloudBooks.length) {
      const empty = document.createElement("p");
      empty.className = "sync-intro";
      empty.textContent = cachedCloudBooks.length
        ? "No matching cloud books."
        : "Your cloud library is empty.";
      list.appendChild(empty);
      return;
    }

    let localBooks = [];
    try {
      await window.openDatabase();
      localBooks = await window.getAllBooks();
    } catch (error) {
      console.error(error);
    }

    cloudDownloadButtons.clear();

    const downloadableBooks = cloudBooks.filter(book =>
      !localBooks.some(local => local.cloudBookId === book.id)
    );

    localBooks.forEach(local => {
      if (local.cloudBookId) selectedCloudIds.delete(local.cloudBookId);
    });

    const toolbar = document.createElement("div");
    toolbar.style.cssText =
      "display:flex;align-items:center;flex-wrap:wrap;gap:12px;" +
      "padding:10px 0;margin-bottom:8px;border-bottom:1px solid var(--line,#ded6dc)";

    const selectLabel = document.createElement("label");
    selectLabel.style.cssText =
      "display:flex;align-items:center;gap:8px;flex:1;font-size:14px;cursor:pointer";

    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.checked = downloadableBooks.length > 0 &&
      downloadableBooks.every(book => selectedCloudIds.has(book.id));
    selectAll.indeterminate = downloadableBooks.some(book =>
      selectedCloudIds.has(book.id)
    ) && !selectAll.checked;
    selectAll.disabled = downloadableBooks.length === 0 || bulkDownloading;

    const selectText = document.createElement("span");
    selectText.textContent = "Select all";
    selectLabel.append(selectAll, selectText);

    const visibleSelectedCount = downloadableBooks.filter(book =>
      selectedCloudIds.has(book.id)
    ).length;

    const bulkButton = document.createElement("button");
    bulkButton.type = "button";
    bulkButton.className = "action secondary";
    bulkButton.textContent =
      "Download selected (" + visibleSelectedCount + ")";
    bulkButton.disabled = visibleSelectedCount === 0 || bulkDownloading;

    selectAll.addEventListener("change", () => {
      if (selectAll.checked) {
        downloadableBooks.forEach(book => selectedCloudIds.add(book.id));
      } else {
        downloadableBooks.forEach(book => selectedCloudIds.delete(book.id));
      }
      renderCloudBooks(cachedCloudBooks);
    });

    bulkButton.addEventListener("click", () => {
      const chosen = cloudBooks.filter(book =>
        selectedCloudIds.has(book.id) &&
        !localBooks.some(local => local.cloudBookId === book.id)
      );
      downloadSelectedCloudBooks(chosen);
    });

    toolbar.append(selectLabel, bulkButton);
    list.appendChild(toolbar);

    cloudBooks.forEach(book => {
      const row = document.createElement("div");
      row.className = "sync-book";

      const info = document.createElement("div");
      info.className = "sync-book-info";

      const title = document.createElement("span");
      title.className = "sync-book-title";
      title.textContent = book.title || "Untitled book";

      const meta = document.createElement("span");
      meta.className = "sync-book-meta";
      meta.textContent =
        (book.author || "Unknown author") + " · " +
        String(book.file_type || "file").toUpperCase();

      info.append(title, meta);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "action secondary sync-download";

      const alreadyDownloaded = localBooks.some(
        local => local.cloudBookId === book.id
      );

      button.textContent = alreadyDownloaded
        ? "Downloaded"
        : "Download";

      button.disabled = alreadyDownloaded || bulkDownloading;
      cloudDownloadButtons.set(book.id, button);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedCloudIds.has(book.id);
      checkbox.disabled = alreadyDownloaded || bulkDownloading;
      checkbox.setAttribute(
        "aria-label",
        "Select " + (book.title || "book")
      );
      checkbox.style.cssText =
        "width:19px;height:19px;flex:0 0 auto;accent-color:#512747";

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedCloudIds.add(book.id);
        else selectedCloudIds.delete(book.id);
        renderCloudBooks(cachedCloudBooks);
      });

      button.addEventListener("click", async () => {
        await downloadBook(book, button);
        renderCloudBooks(cachedCloudBooks);
      });

      row.append(checkbox, info, button);
      list.appendChild(row);
    });
  }

  async function downloadSelectedCloudBooks(chosen) {
    if (bulkDownloading || busy || !chosen.length) return;

    bulkDownloading = true;
    let succeeded = 0;
    let failed = 0;

    try {
      for (let i = 0; i < chosen.length; i++) {
        const book = chosen[i];
        const button = cloudDownloadButtons.get(book.id);

        if (!button) {
          failed++;
          continue;
        }

        message(
          "Downloading " + (book.title || "book") +
          " (" + (i + 1) + " of " + chosen.length + ")…"
        );

        const ok = await downloadBook(book, button);

        if (ok) {
          succeeded++;
          selectedCloudIds.delete(book.id);
        } else {
          failed++;
        }
      }
    } finally {
      bulkDownloading = false;
      await renderCloudBooks(cachedCloudBooks);
      message(
        succeeded + " book(s) downloaded successfully" +
        (failed ? "; " + failed + " failed. You can retry them." : ".")
      );
    }
  }

  async function downloadBook(book, button) {
    if (busy) return false;

    const client = getClient();
    if (!client) {
      message("Account service is not ready.", true);
      return false;
    }

    const type = String(book.file_type || "").toLowerCase();

    if (!["pdf", "epub"].includes(type)) {
      message("Unsupported cloud file type: " + type, true);
      return false;
    }

    if (!book.file_path) {
      message("This cloud book has no Storage file path.", true);
      return false;
    }

    busy = true;
    button.disabled = true;
    button.textContent = "Downloading…";

    try {
      const { data: authData, error: authError } =
        await client.auth.getUser();

      if (authError) throw authError;
      if (!authData?.user) throw new Error("Please sign in again.");

      await window.openDatabase();

      const existing = await window.getAllBooks();
      if (existing.some(local => local.cloudBookId === book.id)) {
        button.textContent = "Downloaded";
        message("This book is already on this device.");
        return true;
      }

      message("Downloading " + (book.title || "your book") + "…");

      const { data: fileBlob, error: downloadError } =
        await client.storage
          .from(BUCKET)
          .download(book.file_path);

      if (downloadError) throw downloadError;
      if (!fileBlob || !fileBlob.size) {
        throw new Error("The downloaded file is empty.");
      }

      const filename =
        (book.title || "MAZORA-book").replace(/[\/\\]/g, "_") +
        "." + type;

      const mimeType = type === "pdf"
        ? "application/pdf"
        : "application/epub+zip";

      const db = await window.openDatabase();

      await new Promise((resolve, reject) => {
        const tx = db.transaction(
          ["readerFiles", "books"],
          "readwrite"
        );

        const fileStore = tx.objectStore("readerFiles");
        const bookStore = tx.objectStore("books");
        let fileId = null;

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(
          tx.error || new Error("Local save failed.")
        );
        tx.onabort = () => reject(
          tx.error || new Error("Local save was cancelled.")
        );

        const fileRequest = fileStore.add({
          name: filename,
          type,
          mimeType,
          blob: fileBlob,
          added: new Date().toISOString()
        });

        fileRequest.onsuccess = () => {
          fileId = fileRequest.result;

          bookStore.add({
            title: book.title || filename,
            author: book.author || "Unknown author",
            cover: book.cover_url || "",
            status: "TBR",
            added: new Date().toISOString(),
            readerFileId: fileId,
            fileType: type,
            cloudBookId: book.id
          });
        };

        fileRequest.onerror = () => {
          reject(fileRequest.error ||
            new Error("Could not save the downloaded file."));
        };
      });

      if (typeof window.refresh === "function") {
        await window.refresh();
      }

      button.textContent = "Downloaded";
      message(
        "Downloaded successfully! " +
        (book.title || "Your book") +
        " is now available in My Device and can be read offline."
      );
      return true;

    } catch (error) {
      console.error("MAZORA cloud download error:", error);
      button.disabled = false;
      button.textContent = "Retry download";
      message("Download failed: " +
        (error.message || String(error)), true);
      return false;
    } finally {
      busy = false;
    }
  }

  function init() {
    createPanel();

    if (!panel) {
      console.warn("MAZORA Cloud Sync: upload panel not found.");
      return;
    }
  }

  window.mazoraLoadCloudBooks = loadCloudBooks;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
