import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const DropZone = ({ title, apps, onDrop }) => {
    const [isOver, setIsOver] = useState(false);

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsOver(true);
    };

    const handleDragLeave = () => {
        setIsOver(false);
    };

    const handleDrop = (e) => {
        setIsOver(false);
        onDrop(e);
    };

    const borderColor = isOver
        ? 'border-white'
        : 'border-white/10';

    const bgGradient = 'from-white/5 to-white/5';

    return (
        <div
            className={`flex-1 h-full rounded-2xl border-2 ${borderColor} bg-gradient-to-br ${bgGradient} backdrop-blur-sm transition-colors duration-300 flex flex-col overflow-hidden relative`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <div className="p-6 border-b border-white/5">
                <h2 className="text-2xl font-bold text-center text-white">
                    {title}
                </h2>
            </div>

            <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                {apps.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-white/5 rounded-xl">
                        <p className="text-lg mb-2">Drag apps here</p>
                        <p className="text-sm opacity-50">Build your {title}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                        <AnimatePresence>
                            {apps.map((app) => (
                                <motion.div
                                    key={app.id}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    layout
                                    className="aspect-square rounded-xl bg-white/25 backdrop-blur-sm border border-white/30 flex flex-col items-center justify-center p-3 gap-2 hover:shadow-lg hover:bg-white/30 transition-all cursor-pointer relative group"
                                >
                                    <img src={app.logo} alt={app.name} className="w-full h-full object-contain pointer-events-none" />

                                    {/* Tooltip on hover in dropzone too */}
                                    <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 text-white text-xs py-1 px-2 rounded pointer-events-none whitespace-nowrap z-10">
                                        {app.name}
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            {/* Background Decoration */}
            <div className="absolute bottom-0 right-0 w-32 h-32 bg-white/5 blur-3xl rounded-full pointer-events-none" />
        </div>
    );
};

export default DropZone;
