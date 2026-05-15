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
  // TODO Farizon: estos endpoints son los del flujo Dongfeng — sustituir antes de publicar.
  const ZAPIER_WEBHOOK = '';  // p.ej. 'https://hooks.zapier.com/hooks/catch/3397010/XXXXX/'
  const SHEET_WEBHOOK  = '';  // Apps Script de la hoja "Leads landing Farizon SV"

  function splitName(fullName) {
    const parts = (fullName || '').trim().split(/\s+/);
    return { first: parts.shift() || '', last: parts.join(' ') };
  }

  // E.164 español. Enhanced Conversions exige prefijo internacional para hacer match.
  function normalizePhoneES(raw) {
    let p = (raw || '').replace(/[\s\-().]/g, '');
    if (!p) return '';
    if (p.startsWith('00')) p = '+' + p.slice(2);
    if (p.startsWith('+')) return p;
    if (/^[6789]\d{8}$/.test(p)) return '+34' + p;
    return p;
  }

  // CP español → identificador interno del concesionario oficial Farizon.
  // Solo hay 7 puntos de venta oficiales: Madrid (Majadahonda), Málaga, Sevilla,
  // Zaragoza, Navarra (Noáin), Tarragona (Reus) y Comunidad Valenciana (Gandía).
  // TODO: sustituir los identificadores genéricos por los códigos CRM reales que
  //       use Farizon Auto España.
  function dealerCodeFromCP(cp) {
    const digits = (cp || '').replace(/\D/g, '');
    if (digits.length < 2) return '';
    const province = digits.slice(0, 2);
    const provinceToDealer = {
      '28': 'FARIZON_MADRID',     // Madrid (Majadahonda)
      '29': 'FARIZON_MALAGA',     // Málaga
      '41': 'FARIZON_SEVILLA',    // Sevilla
      '50': 'FARIZON_ZARAGOZA',   // Zaragoza
      '31': 'FARIZON_NAVARRA',    // Navarra (Noáin)
      '43': 'FARIZON_TARRAGONA',  // Tarragona (Reus)
      '46': 'FARIZON_VALENCIA'    // Comunidad Valenciana (Gandía)
    };
    return provinceToDealer[province] || ''; // resto de CP: fallback central
  }

  function buildPayload({ name, last_name, phone, cp, email, dealer }) {
    // TODO Farizon: pedir a Farizon Auto España los códigos reales de
    // Model_Code, Brand_Code, Campaign_Code, Form_Type, Lead_Source, etc.
    // específicos para Farizon SV (los actuales son placeholders).
    return {
      Name: name,
      Last_Name: last_name,
      Email: email || '',
      Phone: phone,
      Model_Code: 'FARIZON_SV',           // placeholder
      Dealership_Code: dealer || '',
      Postal_Code: cp || '',
      Privacy_Policy: 'Y',
      Consent: true,
      Lead_Type: 'TP10',
      Request_Type: 'TPD10',
      Lead_Source: 'OL24',
      Form_Type: 'F12',
      Campaign_Code: 'FARIZON_SV_LANDING', // placeholder
      Brand_Code: 'FAR',                   // placeholder
      Country_Code: 'ES'
    };
  }

  // text/plain (CORS-safe) evita el preflight que Zapier rechaza con application/json.
  // Zapier interpreta el body como JSON igualmente.
  function sendToZapier(payload) {
    if (!ZAPIER_WEBHOOK) return Promise.resolve(null);
    return fetch(ZAPIER_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
      .then(r => r.json().catch(() => ({ status: r.ok ? 'success' : 'error' })))
      .then(res => { console.info('[Farizon] zapier ok:', res); return res; })
      .catch(err => { console.error('[Farizon] zapier error:', err); });
  }

  // Apps Script web app: usa text/plain para evitar el preflight CORS, el body sigue siendo JSON.
  function sendToSheet(payload) {
    if (!SHEET_WEBHOOK) return Promise.resolve(null);
    return fetch(SHEET_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    })
      .then(r => r.text().then(t => { try { return JSON.parse(t); } catch { return { status: r.ok ? 'success' : 'error', raw: t }; } }))
      .then(res => { console.info('[Farizon] sheet ok:', res); return res; })
      .catch(err => { console.error('[Farizon] sheet error:', err); });
  }

  const leadForm = $('#leadForm');
  if (leadForm) {
    leadForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(leadForm).entries());
      const { first, last } = splitName(data.name);
      const dealer = dealerCodeFromCP(data.cp);

      const payload = buildPayload({
        name: first,
        last_name: last,
        phone: data.phone || '',
        cp: data.cp || '',
        email: data.email || '',
        dealer
      });

      sendToZapier(payload);
      sendToSheet(payload);

      // Enhanced Conversions: GTM hashea (SHA-256) los campos de enhanced_conversion_data
      // antes de mandarlos a Google Ads. No hashear aquí.
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'generate_lead',
        form_name: 'test_drive',
        dealer,
        enhanced_conversion_data: {
          email: data.email || '',
          phone_number: normalizePhoneES(data.phone),
          address: {
            first_name: first,
            last_name: last,
            postal_code: data.cp || '',
            country: 'ES'
          }
        }
      });

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
  $$('.coverage__pin').forEach(pin => {
    pin.addEventListener('click', () => {
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
