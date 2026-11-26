// Dispatchio icon set. Drawn for this product: 24 x 24 grid, rounded geometry that echoes the logo's pill-and-circle shapes,
// outline strokes with solid fills where the reference design uses weight (handset, truck, person, transport controls).
const CUT = 'stroke="var(--cut,#fff)"';
const ICONS = {
  // brand and navigation
  'phone': '<path d="M8.1 3.9 6.3 4.5c-1.2.4-1.9 1.7-1.5 2.9 1.5 5 5.4 8.9 10.4 10.4 1.2.4 2.5-.3 2.9-1.5l.6-1.8c.2-.6-.1-1.3-.7-1.5l-2.7-1c-.5-.2-1.1 0-1.4.4l-.9 1.1a9.8 9.8 0 0 1-3.8-3.8l1.1-.9c.4-.3.6-.9.4-1.4l-1-2.7c-.2-.6-.9-.9-1.5-.7Z"/>',
  'phone-solid': '<path fill="currentColor" stroke="currentColor" stroke-width="1.2" d="M8.1 3.9 6.3 4.5c-1.2.4-1.9 1.7-1.5 2.9 1.5 5 5.4 8.9 10.4 10.4 1.2.4 2.5-.3 2.9-1.5l.6-1.8c.2-.6-.1-1.3-.7-1.5l-2.7-1c-.5-.2-1.1 0-1.4.4l-.9 1.1a9.8 9.8 0 0 1-3.8-3.8l1.1-.9c.4-.3.6-.9.4-1.4l-1-2.7c-.2-.6-.9-.9-1.5-.7Z"/>',
  'chart': '<rect x="4" y="12" width="3.8" height="8" rx="1.7" fill="currentColor" stroke="none"/><rect x="10.1" y="4.5" width="3.8" height="15.5" rx="1.7" fill="currentColor" stroke="none"/><rect x="16.2" y="8.5" width="3.8" height="11.5" rx="1.7" fill="currentColor" stroke="none"/>',
  'chart-line': '<path d="M5 19V13M12 19V5M19 19v-8"/>',
  'gear': '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.6"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7"/>',
  'gear-solid': '<circle cx="12" cy="12" r="6.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2.5" fill="var(--cut,#fff)" stroke="none"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7" stroke-width="2.4"/>',
  'queue': '<circle cx="5.3" cy="6.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="5.3" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="5.3" cy="17.5" r="1.4" fill="currentColor" stroke="none"/><path d="M9.5 6.5H20M9.5 12H20M9.5 17.5h7"/>',
  'list': '<path d="M5 6.5h14M5 12h14M5 17.5h9"/>',
  'bookmark': '<path d="M7.5 4h9A1.5 1.5 0 0 1 18 5.5V20l-6-4.2L6 20V5.5A1.5 1.5 0 0 1 7.5 4Z"/>',
  'bookmark-solid': '<path fill="currentColor" d="M7.5 4h9A1.5 1.5 0 0 1 18 5.5V20l-6-4.2L6 20V5.5A1.5 1.5 0 0 1 7.5 4Z"/>',
  'users': '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.2 19.5c.4-3.3 2.8-5.3 5.8-5.3s5.4 2 5.8 5.3"/><path d="M15.6 5.6a3.1 3.1 0 0 1 0 5.8M17.6 14.5c1.8.7 3 2.3 3.2 5"/>',
  // status and feedback
  'chevron-down': '<path d="m6 9.5 6 6 6-6"/>', 'chevron-up': '<path d="m6 14.5 6-6 6 6"/>', 'chevron-left': '<path d="m14.5 6-6 6 6 6"/>', 'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  'arrow-right': '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
  'x': '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  'check': '<path d="m5 12.8 4.4 4.4L19 7.4"/>',
  'check-check': '<path d="m2.6 13 4.2 4.2L14.6 8.4M11.2 15.6l1 1L21.4 7.2"/>',
  'info': '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2"/><circle cx="12" cy="7.9" r="1.1" fill="currentColor" stroke="none"/>',
  'circle-alert': '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6v5.2"/><circle cx="12" cy="16.2" r="1.1" fill="currentColor" stroke="none"/>',
  'triangle-alert': '<path d="M10.3 4.6 3.3 17a2 2 0 0 0 1.7 3h14a2 2 0 0 0 1.7-3l-7-12.4a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4"/><circle cx="12" cy="16.7" r="1" fill="currentColor" stroke="none"/>',
  'circle-check': '<circle cx="12" cy="12" r="8.6" fill="currentColor" stroke="none"/><path d="m8 12.3 2.8 2.8 5.3-5.6" stroke="var(--cut,#fff)" stroke-width="2.1"/>',
  'ban': '<circle cx="12" cy="12" r="8.4"/><path d="M6 6l12 12"/>',
  'star': '<path fill="currentColor" stroke-width="1.3" d="m12 3.4 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8Z"/>',
  'sparkles': '<path fill="currentColor" stroke="none" d="M10 3.2c.4 2.9 1.8 4.4 4.7 4.8-2.9.4-4.3 1.9-4.7 4.8-.4-2.9-1.8-4.4-4.7-4.8C8.2 7.6 9.6 6.1 10 3.2Z"/><path fill="currentColor" stroke="none" d="M17.8 12.6c.3 1.9 1.2 2.9 3.1 3.2-1.9.3-2.8 1.3-3.1 3.2-.3-1.9-1.2-2.9-3.1-3.2 1.9-.3 2.8-1.3 3.1-3.2Z"/>',
  'refresh': '<path d="M19.5 12a7.5 7.5 0 0 1-13 5M4.5 12a7.5 7.5 0 0 1 13-5"/><path d="M17.8 3.6V7.4h-3.8M6.2 20.4v-3.8H10"/>',
  'power': '<path d="M12 3.4v8"/><path d="M7.1 6.4a7.3 7.3 0 1 0 9.8 0"/>',
  'clock': '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  'target': '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  'shield': '<path d="M12 3.2 19 6v5.4c0 4.3-2.8 7.7-7 9.4-4.2-1.7-7-5.1-7-9.4V6Z"/>',
  'calendar': '<rect x="4" y="5.5" width="16" height="14.5" rx="3.2"/><path d="M4 10.4h16M8.2 3.6v3.6M15.8 3.6v3.6"/><circle cx="8.6" cy="14.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="14.6" r="1.1" fill="currentColor" stroke="none"/>',
  'eye': '<path d="M2.8 12S6 6.2 12 6.2 21.2 12 21.2 12 18 17.8 12 17.8 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  'eye-off': '<path d="M9.8 6.5c.7-.2 1.4-.3 2.2-.3 6 0 9.2 5.8 9.2 5.8s-.9 1.6-2.6 3.1M6.2 8.3C3.9 9.9 2.8 12 2.8 12s3.2 5.8 9.2 5.8c1 0 2-.2 2.8-.5"/><path d="M10 10a2.8 2.8 0 0 0 4 4M4 4l16 16"/>',
  'ellipsis': '<circle cx="12" cy="5.8" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="18.2" r="1.7" fill="currentColor" stroke="none"/>',
  // transport controls (solid, like the reference)
  'skip': '<path fill="currentColor" stroke-width="1.6" d="M6.4 5.6v12.8c0 .8.9 1.3 1.6.8l8.6-6.4a1 1 0 0 0 0-1.6L8 4.8c-.7-.5-1.6 0-1.6.8Z"/><rect x="17.6" y="5" width="2.4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  'pause': '<rect x="6.2" y="4.8" width="4.1" height="14.4" rx="1.6" fill="currentColor" stroke="none"/><rect x="13.7" y="4.8" width="4.1" height="14.4" rx="1.6" fill="currentColor" stroke="none"/>',
  'play': '<path fill="currentColor" stroke-width="1.6" d="M7.4 5.6v12.8c0 .8.9 1.3 1.6.8l9.4-6.4a1 1 0 0 0 0-1.6L9 4.8c-.7-.5-1.6 0-1.6.8Z"/>',
  'copy': '<rect x="9" y="9" width="11" height="11" rx="3"/><path d="M15 9V7.5A3.5 3.5 0 0 0 11.5 4h-4A3.5 3.5 0 0 0 4 7.5v4A3.5 3.5 0 0 0 7.5 15H9"/>',
  'clipboard': '<rect x="5" y="4.5" width="14" height="16" rx="3"/><path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5"/><path d="M9 11h6M9 15h4"/>',
  // people and places
  'user': '<circle cx="12" cy="8.2" r="3.7"/><path d="M4.8 20c.4-3.6 3.3-5.8 7.2-5.8s6.8 2.2 7.2 5.8"/>',
  'user-solid': '<circle cx="12" cy="8" r="4" fill="currentColor" stroke="none"/><path fill="currentColor" stroke="none" d="M4.3 19.6c0-3.7 3.4-5.9 7.7-5.9s7.7 2.2 7.7 5.9c0 .7-.5 1.1-1.1 1.1H5.4c-.6 0-1.1-.4-1.1-1.1Z"/>',
  'building': '<rect x="4.5" y="3.5" width="10" height="17" rx="2.4"/><path d="M14.5 9.5h3.4a1.6 1.6 0 0 1 1.6 1.6v7.8a1.6 1.6 0 0 1-1.6 1.6h-3.4"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="11" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="11" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M8.5 20.5v-3.2h2v3.2"/>',
  'truck-solid': '<path fill="currentColor" stroke="none" d="M2.5 7.6C2.5 6.7 3.2 6 4.1 6h8.3c.9 0 1.6.7 1.6 1.6V16H2.5Z"/><path fill="currentColor" stroke="none" d="M14.8 9.2h3.3c.5 0 1 .3 1.3.7l1.7 2.7c.2.3.3.6.3.9V16h-6.6Z"/><circle cx="7.3" cy="17.2" r="2.5" fill="currentColor" stroke="var(--cut,#fff)" stroke-width="1.6"/><circle cx="17" cy="17.2" r="2.5" fill="currentColor" stroke="var(--cut,#fff)" stroke-width="1.6"/><path d="M16.2 10.9h2.1l1.2 2" stroke="var(--cut,#fff)" stroke-width="1.3"/>',
  'map-pin': '<path d="M12 21s-6.6-5.5-6.6-11a6.6 6.6 0 0 1 13.2 0c0 5.5-6.6 11-6.6 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  'mail': '<rect x="3.2" y="5.2" width="17.6" height="13.6" rx="3.2"/><path d="m4.4 7.8 6.4 5a2 2 0 0 0 2.4 0l6.4-5"/>',
  'external': '<path d="M13.5 4.5H19.5v6M19.5 4.5l-8 8"/><path d="M17.5 14v3.5a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2H11"/>',
  'pencil': '<path d="m5 19 .9-3.9L16.4 4.6a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L8.9 18.1Z"/><path d="m14.6 6.4 3 3"/>',
  'trash': '<path d="M4.5 6.8h15M9.5 6.8V5.3c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.5"/><path d="M6.3 6.8l.8 11.6c.1 1.1 1 1.9 2.1 1.9h5.6c1.1 0 2-.8 2.1-1.9l.8-11.6"/><path d="M10.2 10.6v5.2M13.8 10.6v5.2"/>',
  'download': '<path d="M12 4v11M7.5 10.8 12 15.3l4.5-4.5"/><path d="M5 19.5h14"/>', 'upload': '<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9"/><path d="M5 19.5h14"/>',
  'database': '<ellipse cx="12" cy="6.2" rx="7.2" ry="2.8"/><path d="M4.8 6.2v11.6c0 1.5 3.2 2.8 7.2 2.8s7.2-1.3 7.2-2.8V6.2"/><path d="M4.8 12c0 1.5 3.2 2.8 7.2 2.8s7.2-1.3 7.2-2.8"/>',
  'handshake': '<path fill="currentColor" stroke="none" d="M1.8 9.4 5.4 7.6l2.6 5.8L4.4 15.2Z"/><path fill="currentColor" stroke="none" d="M22.2 9.4 18.6 7.6l-2.6 5.8 3.6 1.8Z"/><path d="M8 8.6l3.2-1.5c.5-.2 1.1-.1 1.5.3l.9.9M16 8.6l-2.4.2"/><path d="M8.2 13.2l2.2 2.1c.6.5 1.4.5 1.9 0m-1.2-1.2 1.1 1.1c.5.5 1.3.5 1.8 0s.5-1.4 0-1.9m-1.4-1.1.8.8c.5.5 1.3.5 1.8 0s.5-1.3 0-1.8L13.2 9.4l-2.1 1.6c-.6.4-1.4.4-2-.1"/>',
};
function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('width', size || 16); svg.setAttribute('height', size || 16); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}
function hydrateIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach((el) => {
    if (el.querySelector(':scope > svg.ic')) return;
    const svg = icon(el.dataset.icon, Number(el.dataset.size) || 16); svg.classList.add('ic');
    el.prepend(svg);
  });
}
