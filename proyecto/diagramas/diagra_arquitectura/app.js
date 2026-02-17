(function () {
      const app = document.querySelector(".app");
      const mainArea = document.querySelector(".main-area");
      const viewer = document.getElementById("viewer");
      const diagram = document.getElementById("diagram");
      const diagramContent = document.querySelector(".diagram-content");
      const sidebar = document.getElementById("sidebar");
      const splitter = document.getElementById("splitter");
      const zoomInfo = document.getElementById("zoomInfo");
      const zoomInfoPanel = document.getElementById("zoomInfoPanel");
      const zoomSlider = document.getElementById("zoomSlider");
      const zoomInBtn = document.getElementById("zoomIn");
      const zoomOutBtn = document.getElementById("zoomOut");
      const zoomInFloatingBtn = document.getElementById("zoomInFloating");
      const zoomOutFloatingBtn = document.getElementById("zoomOutFloating");
      const zoomFitFloatingBtn = document.getElementById("zoomFitFloating");
      const resetViewBtn = document.getElementById("resetView");
      const resetFiltersBtn = document.getElementById("resetFilters");
      const viewerHint = document.getElementById("viewerHint");
      const flowToggleButtons = document.querySelectorAll(".flow-toggle-btn[data-flow]");
      const loopToggleButtons = document.querySelectorAll(".flow-toggle-btn[data-loop-id]");

      const DIAGRAM_W = 3000;
      const DIAGRAM_H = 2300;
      const CONTENT_OFFSET_X = 120;
      const CONTENT_OFFSET_Y = 100;
      const CONTENT_BASE_SCALE = 1.35;
      const FIT_MARGIN = 36;
      const FIT_SCALE_MULTIPLIER_DESKTOP = 0.90;
      const FIT_SCALE_MULTIPLIER_COMPACT = 1.02;
      const MIN_SCALE = 0.04;
      const MAX_SCALE = 12.0;

      let scale = 1;
      let panX = 0;
      let panY = 0;
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let isResizingPanel = false;
      let startPanelX = 0;
      let startPanelWidth = 0;
      // More compact UI by default (closer to how it looked at browser zoom ~33%).
      const DEFAULT_SIDEBAR_RATIO = 0.22;
      let lastNonZeroSidebarWidth = 380;
      let panelCollapsed = false;
      let panelCollapseForced = null;

      function isCompactViewport() {
        return window.matchMedia("(max-width: 1024px)").matches;
      }

      function getFitScaleMultiplier() {
        return isCompactViewport() ? FIT_SCALE_MULTIPLIER_COMPACT : FIT_SCALE_MULTIPLIER_DESKTOP;
      }

      function getDefaultSidebarWidth() {
        return Math.round(Math.min(440, Math.max(260, mainArea.clientWidth * DEFAULT_SIDEBAR_RATIO)));
      }

      function applyTransform() {
        diagram.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        const zoomText = Math.round(scale * 100) + "%";
        zoomInfo.textContent = zoomText;
        zoomInfoPanel.textContent = zoomText;
        if (zoomSlider) {
          zoomSlider.value = String(Math.round(scale * 100));
        }
      }

      function setToggleButtonState(btn, active) {
        btn.classList.toggle("active", active);
        btn.textContent = active ? "ON" : "OFF";
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      }

      function setLoopButtonState(btn, active) {
        btn.classList.toggle("active", active);
        btn.textContent = active ? "ON" : "OFF";
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      }


      function getContentBounds() {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        Array.from(diagramContent.children).forEach((el) => {
          const tag = el.tagName.toLowerCase();
          if (tag === "svg") {
            try {
              const b = el.getBBox();
              if (b && b.width > 0 && b.height > 0) {
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.width);
                maxY = Math.max(maxY, b.y + b.height);
              }
            } catch {
              // Fallback below if SVG bbox is unavailable.
            }
            return;
          }

          const w = el.offsetWidth;
          const h = el.offsetHeight;
          if (w <= 0 && h <= 0) return;
          const x = el.offsetLeft;
          const y = el.offsetTop;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + w);
          maxY = Math.max(maxY, y + h);
        });

        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
          return { x: 0, y: 0, w: DIAGRAM_W, h: DIAGRAM_H };
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }

      function fitToView() {
        const vw = viewer.clientWidth;
        const vh = viewer.clientHeight;
        const b = getContentBounds();
        const contentX = CONTENT_OFFSET_X + b.x * CONTENT_BASE_SCALE;
        const contentY = CONTENT_OFFSET_Y + b.y * CONTENT_BASE_SCALE;
        const contentW = b.w * CONTENT_BASE_SCALE;
        const contentH = b.h * CONTENT_BASE_SCALE;
        const fitW = contentW + FIT_MARGIN * 2;
        const fitH = contentH + FIT_MARGIN * 2;
        const fitScale = Math.min(vw / fitW, vh / fitH);
        scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, fitScale * getFitScaleMultiplier()));
        panX = (vw - contentW * scale) / 2 - contentX * scale;
        panY = (vh - contentH * scale) / 2 - contentY * scale;
        applyTransform();
      }


      function zoomByFactor(factor) {
        const vw = viewer.clientWidth;
        const vh = viewer.clientHeight;
        const cx = vw / 2;
        const cy = vh / 2;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
        panX = cx - (cx - panX) * (newScale / scale);
        panY = cy - (cy - panY) * (newScale / scale);
        scale = newScale;
        applyTransform();
      }


      function resetFilters() {
        flowToggleButtons.forEach((btn) => {
          const flow = btn.dataset.flow;
          const isMain = flow === "main";
          setToggleButtonState(btn, isMain);
          document.querySelectorAll(".flow-" + flow).forEach((el) => {
            el.classList.toggle("flow-off", !isMain);
          });
        });

        loopToggleButtons.forEach((btn) => {
          const loopId = btn.dataset.loopId;
          setLoopButtonState(btn, false);
          document.querySelectorAll(".loop-" + loopId + "-el").forEach((el) => {
            el.classList.add("loop-item-off");
          });
        });
      }

      function applyInitialStateFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const exportMode =
          params.get("export") === "1" ||
          params.get("mode") === "export";

        if (exportMode) {
          document.documentElement.classList.add("export-mode");
        }

        const flowsParam = params.get("flows");
        if (flowsParam) {
          const enabled = new Set(
            flowsParam
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          );
          ["main", "feedback", "participacion", "ide", "fiscal", "condicional"].forEach((flow) => {
            const active = enabled.has(flow);
            const btn = document.querySelector(`.flow-toggle-btn[data-flow="${flow}"]`);
            if (btn) setToggleButtonState(btn, active);
            document.querySelectorAll(".flow-" + flow).forEach((el) => {
              el.classList.toggle("flow-off", !active);
            });
          });
        }

        const loopsParam = params.get("loops");
        if (loopsParam) {
          const enabled = new Set(
            loopsParam
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          );
          ["r1", "r2", "r3", "b1"].forEach((loopId) => {
            const active = enabled.has(loopId);
            const btn = document.querySelector(`.flow-toggle-btn[data-loop-id="${loopId}"]`);
            if (btn) setLoopButtonState(btn, active);
            document.querySelectorAll(".loop-" + loopId + "-el").forEach((el) => {
              el.classList.toggle("loop-item-off", !active);
            });
          });
        }

        const panelParam = (params.get("panel") || "").toLowerCase();
        if (exportMode || panelParam === "off" || panelParam === "0" || panelParam === "false") {
          panelCollapseForced = true;
        } else if (panelParam === "on" || panelParam === "1" || panelParam === "true") {
          panelCollapseForced = false;
        }
        setPanelCollapsed(panelCollapseForced === null ? isCompactViewport() : panelCollapseForced);
      }

      function setPanelCollapsed(collapsed) {
        panelCollapsed = Boolean(collapsed);
        app.classList.toggle("panel-collapsed", panelCollapsed);
        if (!panelCollapsed) {
          const fallback = lastNonZeroSidebarWidth > 1 ? lastNonZeroSidebarWidth : getDefaultSidebarWidth();
          const maxWidth = Math.max(220, mainArea.clientWidth - 120);
          const width = Math.max(1, Math.min(maxWidth, Math.round(fallback)));
          sidebar.style.width = width + "px";
          lastNonZeroSidebarWidth = width;
        }
        fitToView();
      }


      function setSidebarWidth(px) {
        if (panelCollapsed) {
          return;
        }
        const maxWidth = Math.max(220, mainArea.clientWidth - 120);
        const width = Math.max(1, Math.min(maxWidth, Math.round(px)));
        sidebar.style.width = width + "px";
        if (width > 1) {
          lastNonZeroSidebarWidth = width;
        }
        fitToView();
      }

      // Initial fit
      fitToView();
      lastNonZeroSidebarWidth = getDefaultSidebarWidth();
      setSidebarWidth(lastNonZeroSidebarWidth);

      splitter.addEventListener("mousedown", function (e) {
        isResizingPanel = true;
        startPanelX = e.clientX;
        startPanelWidth = sidebar.getBoundingClientRect().width;
        e.preventDefault();
      });

      // Mouse wheel zoom
      viewer.addEventListener("wheel", function (e) {
        e.preventDefault();
        const rect = viewer.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));

        // Zoom toward cursor
        panX = mx - (mx - panX) * (newScale / scale);
        panY = my - (my - panY) * (newScale / scale);
        scale = newScale;
        applyTransform();
      }, { passive: false });

      // Pan with mouse drag
      viewer.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        isDragging = true;
        startX = e.clientX - panX;
        startY = e.clientY - panY;
      });

      window.addEventListener("mousemove", function (e) {
        if (isResizingPanel) {
          const dx = startPanelX - e.clientX;
          setSidebarWidth(startPanelWidth + dx);
          return;
        }
        if (!isDragging) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        applyTransform();
      });

      window.addEventListener("mouseup", function () {
        isDragging = false;
        isResizingPanel = false;
      });

      // Touch support
      let lastTouchDist = 0;
      let lastTouchCenter = null;

      viewer.addEventListener("touchstart", function (e) {
        if (e.touches.length === 1) {
          isDragging = true;
          startX = e.touches[0].clientX - panX;
          startY = e.touches[0].clientY - panY;
        } else if (e.touches.length === 2) {
          isDragging = false;
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          lastTouchDist = Math.sqrt(dx * dx + dy * dy);
          const rect = viewer.getBoundingClientRect();
          lastTouchCenter = {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
          };
        }
      }, { passive: true });

      viewer.addEventListener("touchmove", function (e) {
        e.preventDefault();
        if (e.touches.length === 1 && isDragging) {
          panX = e.touches[0].clientX - startX;
          panY = e.touches[0].clientY - startY;
          applyTransform();
        } else if (e.touches.length === 2 && lastTouchDist) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const factor = dist / lastTouchDist;
          const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));

          const rect = viewer.getBoundingClientRect();
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

          panX = cx - (cx - panX) * (newScale / scale);
          panY = cy - (cy - panY) * (newScale / scale);
          scale = newScale;
          lastTouchDist = dist;
          applyTransform();
        }
      }, { passive: false });

      viewer.addEventListener("touchend", function () {
        isDragging = false;
        lastTouchDist = 0;
      });

      // Zoom slider
      if (zoomSlider) {
        zoomSlider.addEventListener("input", function () {
          const vw = viewer.clientWidth;
          const vh = viewer.clientHeight;
          const cx = vw / 2;
          const cy = vh / 2;
          const sliderScale = Number(zoomSlider.value) / 100;
          const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, sliderScale));
          panX = cx - (cx - panX) * (newScale / scale);
          panY = cy - (cy - panY) * (newScale / scale);
          scale = newScale;
          applyTransform();
        });
      }

      document.getElementById("zoomFit").addEventListener("click", fitToView);
      if (zoomInBtn) zoomInBtn.addEventListener("click", function () { zoomByFactor(1.2); });
      if (zoomOutBtn) zoomOutBtn.addEventListener("click", function () { zoomByFactor(1 / 1.2); });
      if (zoomInFloatingBtn) zoomInFloatingBtn.addEventListener("click", function () { zoomByFactor(1.2); });
      if (zoomOutFloatingBtn) zoomOutFloatingBtn.addEventListener("click", function () { zoomByFactor(1 / 1.2); });
      if (zoomFitFloatingBtn) zoomFitFloatingBtn.addEventListener("click", fitToView);
      if (resetViewBtn) resetViewBtn.addEventListener("click", fitToView);
      if (resetFiltersBtn) resetFiltersBtn.addEventListener("click", resetFilters);

      // Re-fit y ajuste responsivo de panel en resize
      window.addEventListener("resize", function () {
        if (panelCollapseForced === null) {
          setPanelCollapsed(isCompactViewport());
          return;
        }
        if (panelCollapsed) {
          fitToView();
          return;
        }
        const panelVisible = Math.round(sidebar.getBoundingClientRect().width) > 2;
        if (panelVisible) {
          setSidebarWidth(getDefaultSidebarWidth());
        } else {
          fitToView();
        }
      });

      // Estado inicial: todo lo que tiene botón arranca apagado (excepto flujo principal)
      resetFilters();
      applyInitialStateFromUrl();

      // Toggle por loop individual
      loopToggleButtons.forEach((btn) => {
        btn.addEventListener("click", function () {
          const loopId = btn.dataset.loopId;
          const active = !btn.classList.contains("active");
          setLoopButtonState(btn, active);
          document.querySelectorAll(".loop-" + loopId + "-el").forEach((el) => {
            el.classList.toggle("loop-item-off", !active);
          });
        });
      });

      // Toggle por tipo de flujo desde la leyenda
      flowToggleButtons.forEach((btn) => {
        btn.addEventListener("click", function () {
          const flow = btn.dataset.flow;
          const active = !btn.classList.contains("active");
          setToggleButtonState(btn, active);
          document.querySelectorAll(".flow-" + flow).forEach((el) => {
            el.classList.toggle("flow-off", !active);
          });
        });
      });


      if (viewerHint) {
        window.setTimeout(() => {
          viewerHint.classList.add("hidden");
        }, 2600);
      }

    })();
