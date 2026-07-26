import React from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';

const Sidebar = ({ title, apps, side, onDragStart, showAddButton, onAppHover, onAppLeave }) => {

    const handleMouseEnter = (e, app) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onAppHover(app, rect, side);
    };

    return (
        <div className={`w-24 md:w-32 h-full glass-panel m-4 p-4 flex flex-col items-center ${side === 'left' ? 'rounded-r-xl' : 'rounded-l-xl'}`}>
            <h2 className="text-xs font-semibold mb-6 text-gray-400 text-center uppercase tracking-wider">{title}</h2>

            <div className="flex-1 overflow-y-auto w-full flex flex-col items-center space-y-6 custom-scrollbar py-2">
                {apps.map((app, index) => (
                    <div key={app.id} className="relative">
                        <motion.div
                            draggable
                            onDragStart={(e) => onDragStart(e, app)}
                            onMouseEnter={(e) => handleMouseEnter(e, app)}
                            onMouseLeave={onAppLeave}
                            initial={{ opacity: 0, x: side === 'left' ? -20 : 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.05 }}
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.95 }}
                            className="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-white cursor-grab active:cursor-grabbing flex items-center justify-center p-2 shadow-lg hover:shadow-xl transition-shadow"
                        >
                            <img
                                src={app.logo}
                                alt={app.name}
                                className="w-full h-full object-contain pointer-events-none"
                                onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.nextSibling.style.display = 'flex';
                                }}
                            />
                            <div className="w-full h-full items-center justify-center text-gray-600 font-bold text-sm hidden pointer-events-none">
                                {app.name?.charAt(0) || '?'}
                            </div>
                        </motion.div>
                    </div>
                ))}

                {showAddButton && (
                    <motion.button
                        whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.1)' }}
                        whileTap={{ scale: 0.95 }}
                        className="w-12 h-12 md:w-16 md:h-16 rounded-xl border border-dashed border-gray-600 text-gray-400 flex items-center justify-center hover:text-white hover:border-gray-400 transition-colors mt-4"
                    >
                        <Plus size={24} />
                    </motion.button>
                )}
            </div>
        </div>
    );
};

export default Sidebar;
