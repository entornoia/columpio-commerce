export function StoreIcon({ name }: { name: "menu" | "search" | "bag" | "arrow" | "filter" | "chevron" }) {
  const paths = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>,
    bag: <><path d="M5.5 8.5h13l1 12h-15l1-12Z"/><path d="M9 9V6.5a3 3 0 0 1 6 0V9"/></>,
    arrow: <><path d="M4 12h15M14 7l5 5-5 5"/></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>,
    chevron: <><path d="m8 10 4 4 4-4"/></>,
  };
  return <svg className="store-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
