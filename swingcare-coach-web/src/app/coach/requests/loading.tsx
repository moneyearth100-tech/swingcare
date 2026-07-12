export default function RequestsLoading() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand-link">SwingCare Coach</span>
          <span className="topbar-title">요청 인박스</span>
        </div>
      </header>
      <main className="content">
        <p className="muted">목록 불러오는 중…</p>
      </main>
    </div>
  );
}
