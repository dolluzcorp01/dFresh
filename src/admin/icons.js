// Admin sidebar icons: small inline line icons in the same style as the rest of the admin (stroke, round joins,
// currentColor), drawn here so no icon library is added. 24 x 24 grid, shown at 18 px.
const P = {
  dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  sales: <><path d="M3 17l5-5 4 4 8-8" /><path d="M14 8h6v6" /></>,
  leads: <><path d="M4 5h16l1 9v5H3v-5z" /><path d="M3 14h5l1.5 2.5h5L16 14h5" /></>,
  catalogue: <><path d="M3 7.5L12 3l9 4.5-9 4.5z" /><path d="M3 7.5v9L12 21l9-4.5v-9" /><path d="M12 12v9" /></>,
  products: <><path d="M5 8h14l-1.2 12H6.2z" /><path d="M9 8V6.5a3 3 0 016 0V8" /></>,
  categories: <><path d="M3.5 3.5h7.5l9.5 9.5-8 8-9-9z" /><circle cx="8" cy="8" r="1.4" /></>,
  kits: <><rect x="3" y="7.5" width="18" height="12.5" rx="2" /><path d="M9 7.5V5.5h6v2" /><path d="M3 12.5h18" /></>,
  ruler: <><path d="M3.5 16.5L16.5 3.5l4 4-13 13z" /><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2" /></>,
  sheet: <><rect x="3.5" y="4" width="17" height="16" rx="1.5" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5V20" /></>,
  content: <><rect x="3" y="4" width="18" height="12.5" rx="1.5" /><path d="M8.5 20h7M12 16.5V20" /></>,
  banners: <><rect x="3" y="5" width="18" height="14" rx="1.5" /><circle cx="8.5" cy="10" r="1.6" /><path d="M21 15.5l-5-5-9.5 8.5" /></>,
  translations: <><path d="M3.5 5.5h9M8 3.5v2M5 9.5c1.6 3 4 5 7 6M11 5.5c-1 4-3.6 7.6-7 9.5" /><path d="M13 20.5l4-9 4 9M14.4 17.5h5.2" /></>,
  towns: <><path d="M12 21s-6.5-6-6.5-11.5a6.5 6.5 0 0113 0C18.5 15 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.3" /></>,
  options: <><path d="M9 6.5h11.5M9 12h11.5M9 17.5h11.5" /><circle cx="4.8" cy="6.5" r="1.2" /><circle cx="4.8" cy="12" r="1.2" /><circle cx="4.8" cy="17.5" r="1.2" /></>,
  brochures: <><path d="M6 3h8.5L19 7.5V21H6z" /><path d="M14 3v5h5M9 12.5h7M9 16h7" /></>,
  setup: <><path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1" /><circle cx="15" cy="6.5" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17.5" r="2" /></>,
  languages: <><path d="M4 5h16v11H9.5L4 20z" /><path d="M8 9.5h8M8 12.5h5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6" /><path d="M16 4.6a3.2 3.2 0 010 6.3M18 14.3c1.9.7 3 2.6 3 5.7" /></>,
  audit: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13.5V19a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5.5" /></>,
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  collapse: <path d="M12 6l-6 6 6 6M19 6l-6 6 6 6" />,
  expand: <path d="M5 6l6 6-6 6M12 6l6 6-6 6" />,
};

export default function Icon({ name, className }) {
  return (
    <svg className={`a-ico${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {P[name] || null}
    </svg>
  );
}
