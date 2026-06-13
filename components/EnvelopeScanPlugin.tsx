import React, { useRef, useState } from 'react';
import { extractEnvelopeData, EnvelopeExtractResult } from '../services/geminiService';
import { resizeImage } from '../services/imageUtils';

export interface ExtendedEnvelopeExtractResult extends EnvelopeExtractResult {
    imageDataUrl?: string;
}

interface EnvelopeScanPluginProps {
    onExtracted: (data: ExtendedEnvelopeExtractResult) => void;
    isAdmin?: boolean; // Used to default the toggle ON for admins
    /** When true, scanner is only shown when hasPro is true; otherwise shows Pro upsell. Does not consume a credit. */
    proRequired?: boolean;
    hasPro?: boolean;
    onUpgradeClick?: () => void;
}

/**
 * EnvelopeScanPlugin
 * ------------------
 * Self-contained plugin that opens the camera/file picker, sends the image
 * to Gemini Flash for OCR, and returns structured envelope/receipt data via callback.
 */
const EnvelopeScanPlugin: React.FC<EnvelopeScanPluginProps> = ({ onExtracted, isAdmin = false, proRequired = false, hasPro = true, onUpgradeClick }) => {
    const canUseScanner = !proRequired || hasPro;
    const inputRef = useRef<HTMLInputElement>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [lastResult, setLastResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saveToLedger, setSaveToLedger] = useState(isAdmin); // Default ON for admin, OFF for users

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsScanning(true);
        setError(null);
        setLastResult(null);

        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target?.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            // Resize to keep API payload and DB storage small
            const resized = await resizeImage(dataUrl, 768);

            const result = await extractEnvelopeData(resized);

            // Build a short summary for the UI pill
            const parts: string[] = [];
            if (result.price) parts.push(`+$${result.price.toFixed(2)}`);
            if (result.orderId) parts.push(`Order: ${result.orderId}`);
            if (result.source) parts.push(`Store: ${result.source}`);
            if (result.city || result.state) parts.push(`${result.city ?? ''}${result.state ? `, ${result.state}` : ''}`);
            if (result.trackingNumber) parts.push(`#${result.trackingNumber.slice(-6)}`);
            if (result.cardCount) parts.push(`×${result.cardCount}`);

            setLastResult(parts.length ? parts.join(' · ') : 'OK — no fields found');

            onExtracted({
                ...result,
                imageDataUrl: saveToLedger ? resized : undefined
            });

        } catch (err) {
            console.error('[EnvelopeScanPlugin]', err);
            setError('Scan failed — check console');
        } finally {
            setIsScanning(false);
            // Clear file input so the same file can be retried
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    if (!canUseScanner) {
        return (
            <div className="w-full border border-dashed border-silver rounded-lg p-3 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest flex items-center gap-1.5">
                        <i className="fas fa-camera text-poke-accent"></i>
                        Envelope / Receipt Auto-Fill
                        <span className="bg-poke-accent/20 text-poke-accent text-[8px] px-1.5 py-0.5 rounded font-black uppercase">Pro</span>
                    </span>
                </div>
                <p className="text-[10px] text-gray-600">
                    Scan envelopes and invoices to auto-fill acquisition data. Included with pro credits.
                </p>
                {onUpgradeClick && (
                    <button
                        type="button"
                        onClick={onUpgradeClick}
                        className="flex items-center gap-1.5 bg-poke-accent/20 hover:bg-poke-accent/30 border border-poke-accent/40 text-poke-accent text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-md transition-all"
                    >
                        <i className="fas fa-crown text-xs"></i> Get pro credits
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="w-full border border-dashed border-silver rounded-lg p-3 bg-muted/30 space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest flex items-center gap-1.5">
                    <i className="fas fa-camera text-poke-accent"></i>
                    Envelope / Receipt Auto-Fill
                    <span className="bg-poke-accent/20 text-poke-accent text-[8px] px-1.5 py-0.5 rounded font-black uppercase">Pro</span>
                </span>
                <button
                    type="button"
                    disabled={isScanning}
                    onClick={(e) => {
                        e.preventDefault();
                        inputRef.current?.click();
                    }}
                    className="flex items-center gap-1.5 bg-poke-blue/10 hover:bg-poke-blue/20 border border-poke-blue/30 text-poke-blue text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {isScanning
                        ? <><i className="fas fa-spinner fa-spin text-xs"></i> Reading...</>
                        : <><i className="fas fa-camera text-xs"></i> Scan Image</>}
                </button>
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFile}
                />
            </div>

            <div className="flex items-center justify-between border-t border-silver pt-2">
                <label className="text-[10px] text-gray-600 flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={saveToLedger}
                        onChange={(e) => setSaveToLedger(e.target.checked)}
                        className="rounded bg-white border-silver text-poke-accent focus:ring-poke-accent/30 focus:ring-offset-0"
                    />
                    Save Image to Insurance Ledger
                </label>

                {lastResult && (
                    <p className="text-[9px] text-green-600 flex items-center gap-1.5 animate-fade-in line-clamp-1 max-w-[50%]">
                        <i className="fas fa-check-circle"></i> {lastResult}
                    </p>
                )}
                {error && (
                    <p className="text-[9px] text-red-600 flex items-center gap-1.5">
                        <i className="fas fa-exclamation-triangle"></i> {error}
                    </p>
                )}
            </div>
        </div>
    );
};

export default EnvelopeScanPlugin;
