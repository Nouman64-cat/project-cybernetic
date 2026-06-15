'use client';

type View = 'chat' | 'history';

interface Props {
  view: View;
  onViewChange: (v: View) => void;
  activeCount: number;
}

export default function Sidebar({ view, onViewChange, activeCount }: Props) {
  return (
    <aside className="w-56 shrink-0 bg-gray-950 flex flex-col h-screen sticky top-0 border-r border-gray-800">

      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
        <HexLogo />
        <div className="leading-none">
          <div className="text-sm font-bold text-white tracking-tight">Cybernetic</div>
          <div className="text-[9px] uppercase tracking-[0.15em] text-gray-500 mt-0.5">Research AI</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <NavItem
          icon={<ChatIcon />}
          label="New Research"
          active={view === 'chat'}
          onClick={() => onViewChange('chat')}
        />
        <NavItem
          icon={<HistoryIcon />}
          label="Past Researches"
          active={view === 'history'}
          onClick={() => onViewChange('history')}
        />
      </nav>

      {/* Agents legend */}
      <div className="px-4 py-4 border-t border-gray-800">
        <p className="text-[9px] uppercase tracking-widest text-gray-600 mb-2">Agents</p>
        <div className="space-y-1.5">
          {[
            { label: 'Researcher', bg: 'bg-blue-500', short: 'R' },
            { label: 'Synthesizer', bg: 'bg-violet-500', short: 'S' },
            { label: 'Critic', bg: 'bg-amber-500', short: 'C' },
          ].map(({ label, bg, short }) => (
            <div key={short} className="flex items-center gap-2">
              <div className={`h-4 w-4 rounded-full ${bg} flex items-center justify-center text-[8px] font-bold text-white`}>
                {short}
              </div>
              <span className="text-xs text-gray-500">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Active jobs footer */}
      {activeCount > 0 && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 rounded-lg bg-cyan-950 border border-cyan-800 px-3 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs text-cyan-400 font-medium">{activeCount} running</span>
          </div>
        </div>
      )}
    </aside>
  );
}

function NavItem({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
        active
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900'
      }`}
    >
      <span className={`h-4 w-4 ${active ? 'text-cyan-400' : 'text-gray-500'}`}>{icon}</span>
      {label}
    </button>
  );
}

function HexLogo() {
  return (
    <svg width="24" height="24" viewBox="0 0 28 28" fill="none">
      <polygon points="14,2 25,8 25,20 14,26 3,20 3,8" fill="none" stroke="#06b6d4" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="3" fill="#06b6d4" />
      <line x1="14" y1="2" x2="14" y2="5" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
      <line x1="14" y1="23" x2="14" y2="26" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 3a7 7 0 100 14c.742 0 1.454-.115 2.121-.326l2.455 1.22a.75.75 0 001.018-.978l-.74-2.22A7 7 0 0010 3zM6.5 9.25a.75.75 0 000 1.5h7a.75.75 0 000-1.5h-7zm0 3a.75.75 0 000 1.5h4a.75.75 0 000-1.5h-4z" clipRule="evenodd" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
    </svg>
  );
}
