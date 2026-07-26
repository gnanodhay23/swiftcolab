import React from 'react';
import { motion } from 'framer-motion';

const OrbitAnimation = ({ aiApps, workApps }) => {
    const allApps = [...aiApps, ...workApps];
    const radius = 150; // Radius of the orbit

    return (
        <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
            {/* Central Core */}
            <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="absolute z-10 w-32 h-32 rounded-full flex items-center justify-center"
            >
                {/* Glow effect behind */}
                <div className="absolute inset-0 bg-white/30 rounded-full blur-xl" />
                {/* Core circle */}
                <div className="relative w-full h-full bg-gradient-to-br from-gray-900 to-black rounded-full flex items-center justify-center border border-white/30 shadow-lg shadow-white/20">
                    <span className="text-white font-bold text-2xl" style={{ fontFamily: '"Playfair Display", serif', fontStyle: 'italic' }}>OS</span>
                </div>
            </motion.div>

            {/* Orbiting Apps */}
            <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 8, ease: "linear", repeat: Infinity }}
                className="relative w-[400px] h-[400px] flex items-center justify-center"
            >
                {
                    allApps.map((app, index) => {
                        const angle = (index / allApps.length) * 2 * Math.PI;
                        const x = Math.cos(angle) * radius;
                        const y = Math.sin(angle) * radius;

                        return (
                            <motion.div
                                key={app.id}
                                initial={{ scale: 0, opacity: 0, x: 0, y: 0 }}
                                animate={{
                                    scale: 1,
                                    opacity: 1,
                                    x: x,
                                    y: y
                                }}
                                transition={{ duration: 0.5, delay: index * 0.05 }}
                                className="absolute w-12 h-12 rounded-xl bg-white flex items-center justify-center p-2 shadow-lg shadow-white/20"
                            >
                                <img
                                    src={app.logo}
                                    alt={app.name}
                                    className="w-full h-full object-contain"
                                    onError={(e) => {
                                        e.target.style.display = 'none';
                                        e.target.nextSibling.style.display = 'flex';
                                    }}
                                />
                                <div className="w-full h-full items-center justify-center text-gray-600 font-bold text-sm hidden">
                                    {app.name?.charAt(0) || '?'}
                                </div>
                            </motion.div>
                        );
                    })
                }

                {/* Orbit Rings */}
                <div className="absolute inset-0 rounded-full border border-white/20 border-dashed w-full h-full animate-spin-slow" />
                <div className="absolute inset-10 rounded-full border border-white/10 w-[320px] h-[320px] animate-reverse-spin" />
            </motion.div>
        </div>
    );
};

export default OrbitAnimation;
