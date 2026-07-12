export default function RequestDetailLoading() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="brand-link">SwingCare Coach</span>
          <span className="topbar-title">요청 상세</span>
        </div>
      </header>
      <main className="content">
        <p className="muted">상세 불러오는 중…</p>
      </main>
    </div>
  );
}
