import React, { useEffect, useState } from 'react';

interface RecentScan {
    id: string;
    name: string;
    card_set: string;
    overall_grade: string;
    date_scanned: string;
    front_img: string;
}

interface ScrollingMarqueeProps {
    onCardClick?: (id: string) => void;
    variant?: 'stats' | 'marquee' | 'both';
    /** When provided, use this instead of fetching (e.g. from parent that also drives hero). */
    stats?: { total_graded: number; recent_scans: RecentScan[] } | null;
}

const ScrollingMarquee: React.FC<ScrollingMarqueeProps> = ({ onCardClick, variant = 'both', stats: statsProp }) => {
    const [statsLocal, setStatsLocal] = useState<{ total_graded: number; recent_scans: RecentScan[] } | null>(null);
    const stats = statsProp ?? statsLocal;

    useEffect(() => {
        if (statsProp != null) return;
        const fetchStats = async () => {
            try {
                const response = await fetch('api/stats.php?action=global', { credentials: 'include' });
                const data = await response.json();
                setStatsLocal(data);
            } catch (error) {
                console.error("Failed to fetch marquee stats", error);
            }
        };
        fetchStats();
        const interval = setInterval(fetchStats, 60000);
        return () => clearInterval(interval);
    }, [statsProp]);

    if (!stats || !Array.isArray(stats.recent_scans)) return null;

    // Double the items for seamless loop
    const displayScans = [...stats.recent_scans, ...stats.recent_scans];

    const renderStats = () => (
        <div className="flex flex-col items-center justify-center space-y-2 mb-4 animate-fade-in">
            <div className="inline-flex items-center gap-3 bg-white border-2 border-silver px-8 py-3 rounded-2xl shadow">
                <div className="flex flex-col items-center">
                    <span className="text-[10px] text-poke-accent font-black uppercase tracking-[0.2em] leading-none mb-1">Total Graded</span>
                    <div className="flex items-center gap-3">
                        <i className="fas fa-certificate text-poke-accent text-2xl animate-pulse"></i>
                        <span className="text-4xl font-black text-gray-900 font-mono">{stats.total_graded.toLocaleString()}</span>
                    </div>
                </div>
            </div>
            {(variant === 'both' || variant === 'marquee') && (
                <p className="text-[11px] text-gray-500 font-bold uppercase tracking-widest">Global Authentication Network</p>
            )}
        </div>
    );

    const renderMarquee = () => (
        <div className="relative w-full overflow-hidden bg-gradient-to-r from-transparent via-muted to-transparent py-6 border-y border-silver animate-fade-in">
            <div
                className="flex gap-6 whitespace-nowrap marquee-track"
                style={{
                    animation: 'marquee 30s linear infinite',
                    width: 'max-content'
                }}
            >
                {displayScans.map((scan, idx) => (
                    <div
                        key={`${scan.id}-${idx}`}
                        onClick={() => onCardClick?.(scan.id)}
                        className="inline-flex items-center gap-4 bg-white border border-silver p-3 rounded-2xl hover:border-poke-accent hover:shadow transition-all group flex-shrink-0 cursor-pointer"
                        style={{ minWidth: '300px' }}
                    >
                        <div className="w-12 h-16 bg-muted rounded-lg overflow-hidden border border-silver flex-shrink-0">
                            <img
                                src={scan.front_img}
                                className="w-full h-full object-contain"
                                alt={scan.name}
                            />
                        </div>
                        <div className="flex flex-col justify-center overflow-hidden">
                            <span className="text-sm font-black text-gray-900 truncate w-40 group-hover:text-poke-accent transition-colors">{scan.name}</span>
                            <span className="text-[10px] text-gray-600 font-bold uppercase truncate w-40">{scan.card_set}</span>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-[9px] bg-poke-blue/10 text-poke-blue px-2 py-0.5 rounded-full font-black border border-poke-blue/20 uppercase">Grade</span>
                                <span className="text-lg font-black text-poke-accent leading-none">{scan.overall_grade}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Fade Overlays */}
            <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-surface to-transparent pointer-events-none z-10"></div>
            <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-surface to-transparent pointer-events-none z-10"></div>
        </div>
    );

    return (
        <div className="w-full space-y-4 py-4 animate-fade-in">
            {(variant === 'both' || variant === 'stats') && renderStats()}
            {(variant === 'both' || variant === 'marquee') && renderMarquee()}

            <style>{`
                @keyframes marquee {
                    0% { transform: translateX(0); }
                    100% { transform: translateX(-50%); }
                }
                .marquee-track:hover {
                    animation-play-state: paused !important;
                }
            `}</style>
        </div>
    );
};

export default ScrollingMarquee;
