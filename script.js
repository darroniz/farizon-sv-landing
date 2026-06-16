/* ============================================================
   Farizon SV landing — interactions
   - Modal open/close (click, backdrop, Escape, focus trap)
   - Form submit: POST a Zapier + Apps Script (Sheet backup) + dataLayer
   - Success view tras enviar el formulario
   - Sticky CTA mobile (visible after hero, hidden near final CTA)
   - Top bar dismiss
   - Reveal on scroll (respects prefers-reduced-motion)

   TODO antes de publicar:
   - Sustituir ZAPIER_WEBHOOK por el endpoint propio de Farizon (no reutilizar el de Dongfeng).
   - Sustituir SHEET_WEBHOOK por la Apps Script de la hoja "Leads landing Farizon SV".
   - Confirmar con Farizon Auto España los códigos de concesionario (Dealership_Code)
     y los códigos de campaña/marca/modelo a enviar al CRM.
   ============================================================ */

(() => {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  /* ----------  MODAL  ---------- */
  const modal = $('#modal');
  const modalContent = $('.modal__content', modal);
  let lastFocused = null;

  function openModal() {
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    // focus first interactive inside modal after paint
    requestAnimationFrame(() => {
      const firstInput = $('input, button', modal);
      if (firstInput) firstInput.focus();
    });
  }

  function closeModal() {
    modal.hidden = true;
    document.documentElement.style.overflow = '';
    // reset views
    $$('.modal__body', modal).forEach(v => v.hidden = v.dataset.view !== 'form');
    $('#leadForm')?.reset();
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  $$('[data-open-modal]').forEach(btn => btn.addEventListener('click', (e) => {
    e.preventDefault();
    openModal();
  }));

  $$('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
    // simple focus trap
    if (e.key === 'Tab' && !modal.hidden) {
      const focusables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modalContent)
        .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ----------  FORM SUBMIT  ---------- */
  // Gateway Apps Script: loguea el lead en la hoja "Leads landing Farizon SV",
  // filtra bots y reenvía a Zapier (el Zap enruta a HubSpot por Brand_Code/Model_Code).
  // La URL de Zapier vive SOLO en el Apps Script, fuera de este código público.
  const GATEWAY_WEBHOOK = 'https://script.google.com/macros/s/AKfycbx6ZSpiY9JJs4SBttnh5bSY8h-M1OIT5oakOl92E3caZHgZqDPZAq_VCw9-8cKr8DfE/exec';

  // Token compartido con el Apps Script: sin él, el gateway descarta el envío.
  const FORM_TOKEN = 'farsv-x9k4w72mq';

  // HubSpot rechaza contactos sin last_name. Si el usuario solo escribe
  // un nombre, duplicamos el nombre completo en first y last (mismo patrón
  // que el flujo n8n de leads de TikTok de Dongfeng).
  function splitName(fullName) {
    const raw = (fullName || '').trim().replace(/\s+/g, ' ');
    const parts = raw ? raw.split(' ') : [];
    const first = parts.shift() || '';
    const rest = parts.join(' ');
    return { first, last: rest || raw };
  }

  // E.164 español. Enhanced Conversions exige prefijo internacional para hacer match.
  function normalizePhoneES(raw) {
    let p = (raw || '').replace(/[\s\-().]/g, '');
    if (!p) return '';
    if (p.startsWith('00')) p = '+' + p.slice(2);
    if (p.startsWith('+')) return p;
    // Autofill suele dejar "34XXXXXXXXX" sin el "+": le anteponemos el "+".
    if (/^34[6789]\d{8}$/.test(p)) return '+' + p;
    if (/^[6789]\d{8}$/.test(p)) return '+34' + p;
    return p;
  }

  function buildPayload({ name, last_name, phone, cp, email, dealer }) {
    return {
      Name: name,
      Last_Name: last_name,
      Email: email || '',
      Phone: phone,
      Model_Code: '1119',
      Model_Name: 'SuperVAN l1h1',
      Dealership_Code: dealer || '',
      Postal_Code: cp || '',
      Privacy_Policy: 'Y',
      Consent: true,
      Lead_Type: 'TP10',
      Request_Type: 'TPD10',
      Lead_Source: 'OL24',
      Form_Type: 'F12',
      Campaign_Code: 'CPH020',
      Brand_Code: 'FAR',
      Brand_Name: 'FARIZON',
      Country_Code: 'ES',
      Region: 'PEN'
    };
  }

  // Apps Script web app: usa text/plain para evitar el preflight CORS, el body sigue siendo JSON.
  function sendToGateway(payload) {
    if (!GATEWAY_WEBHOOK) return Promise.resolve(null);
    return fetch(GATEWAY_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    })
      .then(r => r.text().then(t => { try { return JSON.parse(t); } catch { return { status: r.ok ? 'success' : 'error', raw: t }; } }))
      .then(res => { console.info('[Farizon] gateway ok:', res); return res; })
      .catch(err => { console.error('[Farizon] gateway error:', err); });
  }

  const leadForm = $('#leadForm');
  if (leadForm) {
    leadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(leadForm).entries());
      const { first, last } = splitName(data.name);
      const phone = normalizePhoneES(data.phone);
      // El usuario elige el concesionario en el formulario; el CP ya no se pide.
      const dealer = data.dealer || '';

      const payload = buildPayload({
        name: first,
        last_name: last,
        phone,
        cp: '',
        email: data.email || '',
        dealer
      });

      // Antibots: token compartido + honeypot. El Apps Script descarta lo que no cuadre.
      payload._t = FORM_TOKEN;
      payload._hp = data.fax || '';

      sendToGateway(payload);

      // Enhanced Conversions: GTM hashea (SHA-256) los campos de enhanced_conversion_data
      // antes de mandarlos a Google Ads. No hashear aquí.
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'generate_lead',
        form_name: 'test_drive',
        dealer,
        enhanced_conversion_data: {
          email: data.email || '',
          phone_number: phone,
          address: {
            first_name: first,
            last_name: last,
            country: 'ES'
          }
        }
      });

      // Meta Pixel: evento estándar de lead.
      if (typeof fbq === 'function') {
        fbq('track', 'Lead');
      }

      // Google Ads: conversión "Envío de formulario para clientes potenciales".
      if (typeof gtag === 'function') {
        gtag('event', 'conversion', {
          send_to: 'AW-18179226818/_FrcCOOI7LAcEML5w9xD',
          value: 1.0,
          currency: 'EUR'
        });
      }

      $$('.modal__body', modal).forEach(v => v.hidden = v.dataset.view !== 'success');
    });
  }

  /* ----------  TOP BAR  ---------- */
  const topbar = $('#topbar');
  $('[data-close-topbar]')?.addEventListener('click', () => {
    topbar.hidden = true;
  });

  /* ----------  STICKY CTA MOBILE  ---------- */
  const stickyCta = $('#stickyCta');
  const heroEl = $('.hero');
  const ctaFinalEl = $('.cta-final');

  if (stickyCta && heroEl && ctaFinalEl && 'IntersectionObserver' in window) {
    let heroVisible = true;
    let ctaFinalVisible = false;

    const heroObs = new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      updateStickyCta();
    }, { threshold: 0.25 });

    const finalObs = new IntersectionObserver(([entry]) => {
      ctaFinalVisible = entry.isIntersecting;
      updateStickyCta();
    }, { threshold: 0.1 });

    heroObs.observe(heroEl);
    finalObs.observe(ctaFinalEl);

    function updateStickyCta() {
      const show = !heroVisible && !ctaFinalVisible;
      stickyCta.classList.toggle('is-visible', show);
    }
  }

  /* ----------  COVERAGE MAP: clic en pin → Google Maps  ---------- */
  const EDIT_MAP = new URLSearchParams(location.search).get('edit') === '1';

  $$('.coverage__pin').forEach(pin => {
    pin.addEventListener('click', (e) => {
      if (EDIT_MAP) return;          // en modo editor el clic no navega
      const url = pin.dataset.gmaps;
      if (!url) return;
      window.open(url, '_blank', 'noopener');
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'coverage_pin_click',
        dealer_city: pin.dataset.city || ''
      });
    });
  });

  /* ----------  COVERAGE MAP: modo editor (?edit=1)  ---------- */
  if (EDIT_MAP) {
    const canvas = $('.coverage__map-canvas');
    if (canvas) {
      const pins = $$('.coverage__pin', canvas);

      const panel = document.createElement('div');
      panel.className = 'edit-panel';
      panel.innerHTML = `
        <h4>Mapa: modo editor</h4>
        <p>Arrastra los pins. Al soltar, las coords se actualizan abajo.</p>
        <pre class="edit-coords"></pre>
        <button type="button" class="edit-copy">Copiar coordenadas</button>
      `;
      document.body.appendChild(panel);
      const coordsEl = $('.edit-coords', panel);

      function updateCoordsPanel() {
        coordsEl.textContent = pins
          .map(p => `${p.dataset.city.padEnd(22)} left: ${p.style.left.padEnd(6)}  top: ${p.style.top}`)
          .join('\n');
      }
      updateCoordsPanel();

      pins.forEach(pin => {
        pin.style.cursor = 'grab';
        let dragging = false, sx, sy, sLeft, sTop;

        function startDrag(clientX, clientY) {
          dragging = true;
          sx = clientX; sy = clientY;
          sLeft = parseFloat(pin.style.left);
          sTop  = parseFloat(pin.style.top);
          pin.style.cursor = 'grabbing';
        }
        function moveDrag(clientX, clientY) {
          if (!dragging) return;
          const r = canvas.getBoundingClientRect();
          const nl = Math.max(0, Math.min(100, sLeft + (clientX - sx) / r.width  * 100));
          const nt = Math.max(0, Math.min(100, sTop  + (clientY - sy) / r.height * 100));
          pin.style.left = nl.toFixed(1) + '%';
          pin.style.top  = nt.toFixed(1) + '%';
          updateCoordsPanel();
        }
        function endDrag() {
          if (dragging) { dragging = false; pin.style.cursor = 'grab'; }
        }

        pin.addEventListener('mousedown', (e) => { e.preventDefault(); startDrag(e.clientX, e.clientY); });
        document.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
        document.addEventListener('mouseup', endDrag);

        pin.addEventListener('touchstart', (e) => { const t = e.touches[0]; startDrag(t.clientX, t.clientY); }, { passive: true });
        document.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) moveDrag(t.clientX, t.clientY); }, { passive: true });
        document.addEventListener('touchend', endDrag);
      });

      $('.edit-copy', panel).addEventListener('click', () => {
        navigator.clipboard.writeText(coordsEl.textContent)
          .then(() => { const b = $('.edit-copy', panel); const old = b.textContent; b.textContent = 'Copiado ✓'; setTimeout(() => b.textContent = old, 1400); })
          .catch(() => alert(coordsEl.textContent));
      });
    }
  }

  /* ----------  GALLERY (carrusel scroll-snap + lightbox)  ---------- */
  const galleryTrack = $('.gallery__track');
  if (galleryTrack) {
    function slideStep() {
      const slide = $('.gallery__slide', galleryTrack);
      if (!slide) return 320;
      const styles = getComputedStyle(galleryTrack);
      const gap = parseFloat(styles.gap || '18') || 18;
      return slide.getBoundingClientRect().width + gap;
    }
    $('[data-gallery-prev]')?.addEventListener('click', () => {
      galleryTrack.scrollBy({ left: -slideStep(), behavior: 'smooth' });
    });
    $('[data-gallery-next]')?.addEventListener('click', () => {
      galleryTrack.scrollBy({ left:  slideStep(), behavior: 'smooth' });
    });
    galleryTrack.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); galleryTrack.scrollBy({ left:  slideStep(), behavior: 'smooth' }); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); galleryTrack.scrollBy({ left: -slideStep(), behavior: 'smooth' }); }
    });

    /* ----- Lightbox ----- */
    const lightbox = $('#lightbox');
    if (lightbox) {
      const lbImg = $('.lightbox__img', lightbox);
      const lbCap = $('.lightbox__caption', lightbox);
      const lbCounter = $('.lightbox__counter', lightbox);
      const slideImgs = $$('.gallery__slide img', galleryTrack);
      let lbIdx = 0;
      let lbLastFocused = null;

      function lbShow(i) {
        lbIdx = (i + slideImgs.length) % slideImgs.length;
        const src = slideImgs[lbIdx];
        lbImg.src = src.currentSrc || src.src;
        lbImg.alt = src.alt || '';
        lbCap.textContent = src.alt || '';
        lbCounter.textContent = (lbIdx + 1) + ' / ' + slideImgs.length;
      }
      function lbOpen(i) {
        lbLastFocused = document.activeElement;
        lbShow(i);
        lightbox.hidden = false;
        document.documentElement.style.overflow = 'hidden';
        requestAnimationFrame(() => $('.lightbox__close', lightbox)?.focus());
      }
      function lbClose() {
        lightbox.hidden = true;
        document.documentElement.style.overflow = '';
        if (lbLastFocused?.focus) lbLastFocused.focus();
      }

      slideImgs.forEach((img, i) => {
        img.parentElement.addEventListener('click', (e) => { e.preventDefault(); lbOpen(i); });
      });
      $('[data-lightbox-close]', lightbox)?.addEventListener('click', lbClose);
      $('[data-lightbox-prev]',  lightbox)?.addEventListener('click', () => lbShow(lbIdx - 1));
      $('[data-lightbox-next]',  lightbox)?.addEventListener('click', () => lbShow(lbIdx + 1));
      lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lbClose(); });
      document.addEventListener('keydown', (e) => {
        if (lightbox.hidden) return;
        if (e.key === 'Escape') lbClose();
        else if (e.key === 'ArrowLeft')  lbShow(lbIdx - 1);
        else if (e.key === 'ArrowRight') lbShow(lbIdx + 1);
      });
    }
  }

  /* ----------  REVEAL ON SCROLL  ---------- */
  const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReducedMotion && 'IntersectionObserver' in window) {
    const revealTargets = $$('.section-head, .step, .press-card, .testimonial, .benefit, .compare-table-wrap');
    revealTargets.forEach(el => el.classList.add('reveal'));
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealObs.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    revealTargets.forEach(el => revealObs.observe(el));
  }

})();
