/** Small white square cursor with haze — desktop pointer only (not mobile). */
const DESKTOP_CURSOR_MQ = '(hover: hover) and (pointer: fine) and (min-width: 900px)';

const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'label',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[tabindex]:not([tabindex="-1"])',
    '.link-wrapper',
    '.intro-video-card',
    '#hero-video-card',
    '#thesis-intro-watch',
    '.train_selection',
    '.builder-tab',
    '.builder-preset',
    '.builder-toggle',
    '.builder-car-read',
    '.render-slider__btn',
    '.render-slider--drag .render-slider__track',
    '.image-lightbox-close',
    '.image-lightbox-prev',
    '.image-lightbox-next',
    '.video-modal-close',
    '.video-modal-backdrop',
    '.showcase-panel img',
    '.thesis-chapter--split article img',
    '#new_visual_text img',
].join(', ');

/** Light-background areas — cursor switches to black for contrast. */
const LIGHT_SURFACE_SELECTOR = [
    '.thesis-chapter--split',
    '#thesis-thanks',
    '#thesis-sources',
].join(', ');

const DARK_SURFACE_SELECTOR = [
    '#menu.menu-open',
    '#hero-overlay',
    '.thesis-chapter--intro',
    '.thesis-chapter--dark',
    '.thesis-chapter--showcase',
    '#controlcontainer',
    '.video-modal.open',
    '.image-lightbox.open',
].join(', ');

let cursorRafId = null;
let cursorMq = null;

function canUseCustomCursor() {
    return window.matchMedia(DESKTOP_CURSOR_MQ).matches;
}

function isLightCursorSurface(el) {
    if (!el) return false;
    if (el.closest(DARK_SURFACE_SELECTOR)) return false;
    if (el.closest(LIGHT_SURFACE_SELECTOR)) return true;
    if (document.body.classList.contains('site-scrolled') && el.closest('#site-fixed-bar')) {
        return true;
    }
    return false;
}

export function initCustomCursor() {
    if (!canUseCustomCursor()) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const follow = reduceMotion ? 1 : 0.28;

    const root = document.createElement('div');
    root.id = 'site-cursor';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
        <div class="site-cursor__haze"></div>
        <div class="site-cursor__core"></div>
    `;
    document.body.appendChild(root);
    document.documentElement.classList.add('has-custom-cursor');

    let tx = -100;
    let ty = -100;
    let x = -100;
    let y = -100;
    let visible = false;

    const tick = () => {
        x += (tx - x) * follow;
        y += (ty - y) * follow;
        root.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
        cursorRafId = requestAnimationFrame(tick);
    };
    cursorRafId = requestAnimationFrame(tick);

    const setVisible = (on) => {
        if (visible === on) return;
        visible = on;
        root.classList.toggle('is-visible', on);
    };

    const onPointerMove = (e) => {
        if (!canUseCustomCursor()) return;
        tx = e.clientX;
        ty = e.clientY;
        setVisible(true);
        const target = document.elementFromPoint(e.clientX, e.clientY);
        root.classList.toggle('is-interactive', Boolean(target?.closest(INTERACTIVE_SELECTOR)));
        root.classList.toggle('is-on-light', isLightCursorSurface(target));
    };

    const onPointerDown = () => root.classList.add('is-pressed');
    const onPointerUp = () => root.classList.remove('is-pressed');
    const onBodyLeave = () => setVisible(false);
    const onBodyEnter = () => setVisible(true);

    const onMouseDown = (e) => {
        const target = e.target;
        if (target?.closest?.('.render-slider__track, .train_selection.consist-car, #consist_scroll')) {
            root.classList.add('is-grabbing');
        }
    };
    const onMouseUp = () => root.classList.remove('is-grabbing');

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    document.body.addEventListener('mouseleave', onBodyLeave);
    document.body.addEventListener('mouseenter', onBodyEnter);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);

    const destroy = () => {
        if (cursorRafId != null) {
            cancelAnimationFrame(cursorRafId);
            cursorRafId = null;
        }
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerdown', onPointerDown);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerUp);
        document.body.removeEventListener('mouseleave', onBodyLeave);
        document.body.removeEventListener('mouseenter', onBodyEnter);
        document.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mouseup', onMouseUp);
        root.remove();
        document.documentElement.classList.remove('has-custom-cursor');
        if (cursorMq) {
            cursorMq.removeEventListener('change', onMqChange);
            cursorMq = null;
        }
    };

    const onMqChange = () => {
        if (!canUseCustomCursor()) destroy();
    };

    cursorMq = window.matchMedia(DESKTOP_CURSOR_MQ);
    cursorMq.addEventListener('change', onMqChange);
}
