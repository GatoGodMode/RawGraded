import React, { useState, useEffect, useRef } from 'react';

interface LogEntry {
    timestamp: string;
    level: 'log' | 'warn' | 'error' | 'info';
    message: string;
    data?: any[];
}

export const AdminDebugConsole: React.FC = () => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;
        const originalInfo = console.info;

        const formatArg = (arg: any): string => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        };

        const addLog = (level: 'log' | 'warn' | 'error' | 'info', args: any[]) => {
            const message = args.map(formatArg).join(' ');
            const entry: LogEntry = {
                timestamp: new Date().toLocaleTimeString(),
                level,
                message,
                data: args.length > 1 ? args.slice(1) : undefined
            };
            setLogs(prev => [...prev.slice(-49), entry]); // Keep last 50 logs
        };

        console.log = (...args) => {
            originalLog(...args);
            addLog('log', args);
        };

        console.warn = (...args) => {
            originalWarn(...args);
            addLog('warn', args);
        };

        console.error = (...args) => {
            originalError(...args);
            addLog('error', args);
        };

        console.info = (...args) => {
            originalInfo(...args);
            addLog('info', args);
        };

        return () => {
            console.log = originalLog;
            console.warn = originalWarn;
            console.error = originalError;
            console.info = originalInfo;
        };
    }, []);

    useEffect(() => {
        if (isOpen && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, isOpen]);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 left-4 z-[9999] bg-gray-900/80 text-white p-2 rounded-lg text-xs font-mono border border-gray-700 shadow-xl backdrop-blur-sm opacity-50 hover:opacity-100 transition-opacity"
            >
                <i className="fas fa-bug text-poke-accent mr-2"></i>Debug
            </button>
        );
    }

    return (
        <div className="fixed bottom-0 left-0 right-0 h-[40vh] bg-gray-950/95 z-[9999] border-t border-poke-accent/30 flex flex-col font-mono text-xs shadow-2xl backdrop-blur-md">
            <div className="flex justify-between items-center p-2 bg-gray-900 border-b border-gray-800">
                <span className="font-bold text-poke-accent uppercase tracking-wider">System Logs</span>
                <div className="flex gap-2">
                    <button onClick={() => setLogs([])} className="px-2 py-1 bg-gray-800 rounded hover:bg-gray-700 text-gray-300">Clear</button>
                    <button onClick={() => setIsOpen(false)} className="px-2 py-1 bg-red-900/50 rounded hover:bg-red-900 text-red-300">Close</button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {logs.map((log, i) => (
                    <div key={i} className={`border-l-2 pl-2 ${log.level === 'error' ? 'border-red-500 bg-red-900/10 text-red-300' :
                            log.level === 'warn' ? 'border-yellow-500 bg-yellow-900/10 text-yellow-300' :
                                'border-gray-500 text-gray-300'
                        }`}>
                        <span className="opacity-50 text-[10px] mr-2">[{log.timestamp}]</span>
                        <span className="whitespace-pre-wrap break-all">{log.message}</span>
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    );
};
