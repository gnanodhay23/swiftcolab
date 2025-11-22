import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './components/Sidebar';
import DropZone from './components/DropZone';
import OrbitAnimation from './components/OrbitAnimation';
import { Search } from 'lucide-react';

// Mock Data
const INITIAL_LEFT_APPS = [
  { id: 'frappe', name: 'Frappe Cloud', logo: '/logos/frappe.png', type: 'saas' },
  { id: 'sap', name: 'SAP', logo: '/logos/sap.png', type: 'saas' },
  { id: 'salesforce', name: 'Salesforce', logo: '/logos/salesforce.png', type: 'saas' },
  { id: 'oracle', name: 'Oracle', logo: '/logos/oracle.png', type: 'saas' },
  { id: 'servicenow', name: 'ServiceNow', logo: '/logos/servicenow.png', type: 'saas' },
  { id: 'workday', name: 'Workday', logo: '/logos/workday.png', type: 'saas' },
  { id: 'athena', name: 'Athena Health', logo: '/logos/athena.svg', type: 'healthcare' },
  { id: 'epic', name: 'Epic Systems', logo: '/logos/epic.png', type: 'healthcare' },
  { id: 'flexport', name: 'Flexport', logo: '/logos/flexport.png', type: 'logistics' },
  { id: 'samsara', name: 'Samsara', logo: '/logos/samsara.png', type: 'logistics' },
];

const INITIAL_RIGHT_APPS = [
  { id: 'teams', name: 'Microsoft Teams', logo: '/logos/teams.png', type: 'productivity' },
  { id: 'jira', name: 'Jira', logo: '/logos/jira.png', type: 'productivity' },
  { id: 'asana', name: 'Asana', logo: '/logos/asana.png', type: 'productivity' },
  { id: 'clickup', name: 'ClickUp', logo: '/logos/clickup.svg', type: 'productivity' },
  { id: 'slack', name: 'Slack', logo: '/logos/slack.png', type: 'productivity' },
  { id: 'zoom', name: 'Zoom', logo: '/logos/zoom.png', type: 'productivity' },
  { id: 'notion', name: 'Notion', logo: '/logos/notion.png', type: 'productivity' },
  { id: 'trello', name: 'Trello', logo: '/logos/trello.png', type: 'productivity' },
  { id: 'monday', name: 'Monday.com', logo: '/logos/monday.png', type: 'productivity' },
];

// Fancy OS Component
const FancyOS = ({ className = "" }) => (
  <span className={`opacity-90 ${className}`} style={{ fontFamily: '"Playfair Display", serif', fontStyle: 'italic', position: 'relative', top: '-0.5em', fontSize: '0.5em' }}>OS</span>
);

function App() {
  const [leftApps, setLeftApps] = useState(INITIAL_LEFT_APPS);
  const [rightApps, setRightApps] = useState(INITIAL_RIGHT_APPS);
  const [aiOsApps, setAiOsApps] = useState([]);
  const [workOsApps, setWorkOsApps] = useState([]);
  const [phase, setPhase] = useState('selection'); // 'selection', 'animating', 'complete'

  // Tooltip State
  const [tooltip, setTooltip] = useState({ visible: false, text: '', x: 0, y: 0, side: 'left' });

  const handleDragStart = (e, app) => {
    e.dataTransfer.setData('appId', app.id);
    e.dataTransfer.setData('source', app.type === 'saas' || app.type === 'healthcare' || app.type === 'logistics' ? 'left' : 'right');
    e.dataTransfer.setData('appData', JSON.stringify(app));
    // Hide tooltip on drag
    setTooltip({ ...tooltip, visible: false });
  };

  const handleDrop = (e, targetZone) => {
    e.preventDefault();
    const appData = JSON.parse(e.dataTransfer.getData('appData'));
    const source = e.dataTransfer.getData('source');

    if (targetZone === 'ai' && source === 'left') {
      if (!aiOsApps.find(a => a.id === appData.id)) {
        setAiOsApps([...aiOsApps, appData]);
      }
    } else if (targetZone === 'work' && source === 'right') {
      if (!workOsApps.find(a => a.id === appData.id)) {
        setWorkOsApps([...workOsApps, appData]);
      }
    }
  };

  const handleCreateOS = () => {
    if (aiOsApps.length > 0 || workOsApps.length > 0) {
      setPhase('animating');
      setTimeout(() => {
        setPhase('complete');
      }, 4000);
    }
  };

  const handleAppHover = (app, rect, side) => {
    setTooltip({
      visible: true,
      text: app.name,
      x: side === 'left' ? rect.right + 10 : rect.left - 10,
      y: rect.top + rect.height / 2,
      side: side
    });
  };

  const handleAppLeave = () => {
    setTooltip({ ...tooltip, visible: false });
  };

  return (
    <div className="relative w-full h-screen bg-black text-white overflow-hidden flex flex-col">
      {/* Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-white/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full h-full flex flex-col">
        {/* Header */}
        <header className="w-full p-6 flex justify-center items-center border-b border-white/5 backdrop-blur-sm">
          <div className="flex items-center leading-none select-none">
            <span className="text-4xl font-bold text-white tracking-tight" style={{ fontFamily: '"Outfit", sans-serif' }}>SwiftCollab</span>
            <FancyOS className="text-3xl ml-1" />
          </div>
        </header>

        {/* Main Content */}
        <AnimatePresence mode="wait">
          {phase === 'selection' && (
            <motion.div
              key="selection"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex-1 flex overflow-hidden"
            >
              {/* Left Sidebar */}
              <Sidebar
                title="SaaS Platforms"
                apps={leftApps}
                side="left"
                onDragStart={handleDragStart}
                onAppHover={handleAppHover}
                onAppLeave={handleAppLeave}
              />

              {/* Center Stage */}
              <div className="flex-1 flex flex-col items-center justify-center p-8 gap-8 relative">
                <div className="flex w-full max-w-5xl gap-8 h-[60vh]">
                  <DropZone
                    title={<>AI <FancyOS className="text-lg" /></>}
                    apps={aiOsApps}
                    onDrop={(e) => handleDrop(e, 'ai')}
                    color="white"
                  />
                  <DropZone
                    title={<>Work <FancyOS className="text-lg" /></>}
                    apps={workOsApps}
                    onDrop={(e) => handleDrop(e, 'work')}
                    color="white"
                  />
                </div>

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleCreateOS}
                  className="px-10 py-4 bg-white/20 backdrop-blur-md border border-white/30 hover:bg-white/25 rounded-full text-lg font-bold shadow-lg shadow-white/10 transition-all text-white flex items-center gap-2"
                >
                  Create SwiftCollab <span className="blink"><FancyOS className="text-lg text-white" /></span>
                </motion.button>
              </div>

              {/* Right Sidebar */}
              <Sidebar
                title="Productivity Apps"
                apps={rightApps}
                side="right"
                onDragStart={handleDragStart}
                showAddButton
                onAppHover={handleAppHover}
                onAppLeave={handleAppLeave}
              />
            </motion.div>
          )}

          {phase === 'animating' && (
            <OrbitAnimation
              key="animating"
              aiApps={aiOsApps}
              workApps={workOsApps}
            />
          )}

          {phase === 'complete' && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="flex-1 flex flex-col items-center justify-center"
            >
              <div className="w-full max-w-2xl">
                <h2 className="text-2xl font-bold text-center mb-8 text-white/70" style={{ fontFamily: '"Outfit", sans-serif' }}>
                  Your Industry Platform is Ready
                </h2>
                <div className="relative group">
                  <div className="absolute -inset-1 bg-white/30 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative flex items-center bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4">
                    <Search className="w-6 h-6 text-gray-400 mr-4" />
                    <input
                      type="text"
                      placeholder="Search your SwiftCollab OS..."
                      className="bg-transparent border-none outline-none text-xl w-full text-white placeholder-gray-500"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="mt-12 flex justify-center gap-4 flex-wrap">
                  {[...aiOsApps, ...workOsApps].slice(0, 5).map((app, i) => (
                    <motion.div
                      key={app.id}
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.1 + 0.5 }}
                      className="w-16 h-16 rounded-xl bg-white border border-white/10 flex items-center justify-center p-2"
                    >
                      <img src={app.logo} alt={app.name} className="w-full h-full object-contain" />
                    </motion.div>
                  ))}
                  {aiOsApps.length + workOsApps.length > 5 && (
                    <div className="w-16 h-16 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-sm text-gray-400">
                      +{aiOsApps.length + workOsApps.length - 5}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global Tooltip */}
        <AnimatePresence>
          {tooltip.visible && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed z-50 pointer-events-none"
              style={{
                top: tooltip.y,
                left: tooltip.x,
                transform: 'translateY(-50%)'
              }}
            >
              <div className={`bg-black/90 backdrop-blur-md border border-white/10 text-white text-sm py-2 px-4 rounded-lg whitespace-nowrap shadow-xl ${tooltip.side === 'right' ? '-translate-x-full' : ''}`}>
                {tooltip.text}
                {/* Arrow */}
                <div className={`absolute top-1/2 transform -translate-y-1/2 ${tooltip.side === 'left' ? 'left-0 -ml-1 border-r-4 border-r-black/90' : 'right-0 -mr-1 border-l-4 border-l-black/90'} border-y-4 border-y-transparent h-0 w-0`} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default App;
