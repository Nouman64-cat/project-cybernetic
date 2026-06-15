import Dashboard from '@/components/Dashboard';

// Server Component — simply mounts the interactive Dashboard.
// Data fetching and polling live inside Dashboard (Client Component)
// because they require useState and useEffect.
export default function Home() {
  return <Dashboard />;
}
