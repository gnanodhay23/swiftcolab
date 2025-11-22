import React from 'react';
import { motion } from 'framer-motion';

const OrbitAnimation = ({ aiApps, workApps }) => {
    const allApps = [...aiApps, ...workApps];
    const radius = 150; // Radius of the orbit

    return (
        <div className="flex-1 flex items-center justify-center relative overflow-hidden">
            {/* Central Core */}
            <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="absolute z-10 w-32 h-32 rounded-full bg-white blur-md flex items-center justify-center"
            >
                <div className="w-full h-full bg-black/30 rounded-full backdrop-blur-sm flex items-center justify-center border border-white/20">
                    <span className="text-white font-bold text-2xl" style={{ fontFamily: '"Playfair Display", serif', fontStyle: 'italic' }}>OS</span>
                </div>
            </motion.div >

            {/* Orbiting Apps */}
            < motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, ease: "linear", repeat: 0 }}
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
                                style={{
                                    // Counter-rotate to keep icons upright if desired, 
                                    // but rotating with the orbit looks more dynamic for this "mixing" phase
                                }}
                            >
                                <img src={app.logo} alt={app.name} className="w-full h-full object-contain" />
                            </motion.div>
                        );
                    })
                }

                {/* Orbit Rings */}
                <div className="absolute inset-0 rounded-full border border-white/20 border-dashed w-full h-full animate-spin-slow" />
                <div className="absolute inset-10 rounded-full border border-white/10 w-[320px] h-[320px] animate-reverse-spin" />
            </motion.div >
        </div >
    );
};

export default OrbitAnimation;
