import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './container/App';
import BlameInspector from './container/BlameInspector';
import CommitInspector from './container/CommitInspector';
import FileHistoryInspector from './container/FileHistoryInspector';
import './styles.css';
import './components/p06-workflows.css';
import { ExternalToolsProvider } from './components/ExternalTools';

const root = document.getElementById('root');
if (!root) throw new Error('The application root is missing.');

const page =
  window.location.hash === '#commit-details' ? (
    <CommitInspector />
  ) : window.location.hash === '#file-history' ? (
    <FileHistoryInspector />
  ) : window.location.hash === '#blame' ? (
    <BlameInspector />
  ) : (
    <ExternalToolsProvider>
      <App />
    </ExternalToolsProvider>
  );

createRoot(root).render(<StrictMode>{page}</StrictMode>);
