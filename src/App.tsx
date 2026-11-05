import PreferencesWindow from './components/Preferences';
import QueryLogWindow from './components/QueryLogWindow';
import DriveWorkspace from './components/DriveWorkspace';
import { useDriveSession } from './hooks/useDriveSession';

function MainApp() {
  const session = useDriveSession();
  return <DriveWorkspace session={session} />;
}

/** Separate Electron windows do not mount the hardware-diagnostic session. */
function App() {
  if (location.hash === '#preferences') return <PreferencesWindow />;
  if (location.hash === '#query-log') return <QueryLogWindow />;
  return <MainApp />;
}

export default App;
