import React, { useState, useEffect } from 'react';
import packData from '../data/packSize.json';
import retailerData from '../data/retailer.json';

interface Preset {
    id: number;
    name: string;
    pack_type: string;
    pack_amount: number;
    pack_cost: number;
    tax: number;
    shipping: number;
    source: string;
}

interface AcquisitionWizardProps {
    isOpen: boolean;
    onClose: () => void;
    onApply: (data: {
        price: number;
        tax: number;
        shipping: number;
        source: string;
        notes: string;
        tracking_number?: string;
        order_id?: string;
    }) => void;
}

const AcquisitionWizard = ({ isOpen, onClose, onApply }: AcquisitionWizardProps) => {
    const [retailerId, setRetailerId] = useState('');
    const [customRetailer, setCustomRetailer] = useState('');
    const [packageType, setPackageType] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [totalPrice, setTotalPrice] = useState('');
    const [totalTax, setTotalTax] = useState('');
    const [totalShipping, setTotalShipping] = useState('');
    const [useTaxShipping, setUseTaxShipping] = useState(false);

    // New fields for Ledger tracking
    const [trackingNumber, setTrackingNumber] = useState('');
    const [orderId, setOrderId] = useState('');

    // Preset State
    const [presets, setPresets] = useState<Preset[]>([]);
    const [selectedPresetId, setSelectedPresetId] = useState<string>('');
    const [newPresetName, setNewPresetName] = useState('');
    const [isSavingPreset, setIsSavingPreset] = useState(false);



    // Type definitions for JSON hacks
    interface PackType {
        package_type: string;
        total_scannable_cards: number;
    }
    interface Retailer {
        id: string;
        name: string;
        type?: string;
        focus?: string;
        region?: string;
    }

    // Flatten pack data for easier access
    const allPackTypes: PackType[] = [
        ...packData.pokemon_tcg_data.english_international,
        ...packData.pokemon_tcg_data.japanese_ocg,
        ...packData.pokemon_tcg_data.promotional_specialty
    ];

    // Flatten retailer data
    const allRetailers: Retailer[] = [
        ...retailerData.pokemon_card_sources.official_direct,
        ...retailerData.pokemon_card_sources.major_retailers,
        ...retailerData.pokemon_card_sources.tcg_marketplaces,
        ...retailerData.pokemon_card_sources.dedicated_hobby_shops,
        ...retailerData.pokemon_card_sources.japanese_importers
    ];

    useEffect(() => {
        if (isOpen) {
            fetchPresets();
        }
    }, [isOpen]);

    const fetchPresets = async () => {
        try {
            const res = await fetch('api/presets.php', { credentials: 'include' });

            if (!res.ok) {
                console.error(`Failed to fetch presets: HTTP ${res.status} ${res.statusText}`);
                const errorText = await res.text();
                console.error('Response:', errorText);
                setPresets([]); // Set empty array on error
                return;
            }

            const data = await res.json();
            console.log('Presets loaded:', data);

            if (data.presets) {
                setPresets(data.presets);
            } else if (data.error) {
                console.error('API error:', data.error);
                setPresets([]);
            } else {
                setPresets([]);
            }
        } catch (e) {
            console.error("Failed to load presets:", e);
            setPresets([]);
        }
    };

    const loadPreset = (presetId: string) => {
        const preset = presets.find(p => p.id === parseInt(presetId));
        if (preset) {
            setPackageType(preset.pack_type || '');
            setQuantity(preset.pack_amount || 1);
            setTotalPrice(preset.pack_cost?.toString() || '');
            setTotalTax(preset.tax?.toString() || '');
            setTotalShipping(preset.shipping?.toString() || '');
            setUseTaxShipping((preset.tax > 0 || preset.shipping > 0));

            // Handle Source
            const knownRetailer = allRetailers.find(r => r.name === preset.source);
            if (knownRetailer) {
                setRetailerId(knownRetailer.id);
                setCustomRetailer('');
            } else {
                setRetailerId('custom');
                setCustomRetailer(preset.source || '');
            }
        }
        setSelectedPresetId(presetId);
    };

    const savePreset = async () => {
        if (!newPresetName) return;

        // Resolve source name
        let sourceName = customRetailer;
        if (retailerId && retailerId !== 'custom') {
            sourceName = allRetailers.find(r => r.id === retailerId)?.name || '';
        }

        const payload = {
            name: newPresetName,
            pack_type: packageType,
            pack_amount: quantity,
            pack_cost: parseFloat(totalPrice) || 0,
            tax: parseFloat(totalTax) || 0,
            shipping: parseFloat(totalShipping) || 0,
            source: sourceName
        };

        try {
            const res = await fetch('/api/presets.php', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.status === 'success') {
                setNewPresetName('');
                setIsSavingPreset(false);
                fetchPresets();
            }
        } catch (e) {
            console.error("Failed to save preset", e);
        }
    };

    const deletePreset = async (id: number) => {
        if (!confirm('Delete this preset?')) return;
        try {
            await fetch(`/api/presets.php?id=${id}`, { method: 'DELETE', credentials: 'include' });
            fetchPresets();
            if (selectedPresetId === id.toString()) {
                setSelectedPresetId('');
            }
        } catch (e) {
            console.error("Failed to delete", e);
        }
    };


    const handleApply = () => {
        const selectedPack = allPackTypes.find(p => p.package_type === packageType);
        const selectedRetailer = allRetailers.find(r => r.id === retailerId);

        // Default to 1 scannable card if not found (fallback)
        const cardsPerUnit = selectedPack ? selectedPack.total_scannable_cards : 1;
        const totalItems = quantity * cardsPerUnit;

        const priceVal = parseFloat(totalPrice) || 0;
        const taxVal = parseFloat(totalTax) || 0;
        const shippingVal = parseFloat(totalShipping) || 0;

        // Calculate PER CARD metrics
        const unitPrice = priceVal / totalItems;
        const unitTax = taxVal / totalItems;
        const unitShipping = shippingVal / totalItems;

        // Construct Notes
        let sourceName = customRetailer;
        if (retailerId && selectedRetailer) {
            sourceName = selectedRetailer.name;
        }

        let notes = `Pulled from ${packageType || 'Unknown Source'}`;
        if (sourceName) {
            notes += ` purchased from ${sourceName}`;
        }
        if (quantity > 1) {
            notes += ` (Part of ${quantity}x bulk buy)`;
        }

        onApply({
            price: parseFloat(unitPrice.toFixed(2)),
            tax: parseFloat(unitTax.toFixed(2)),
            shipping: parseFloat(unitShipping.toFixed(2)),
            source: sourceName,
            notes: notes,
            tracking_number: trackingNumber,
            order_id: orderId
        });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-[#0a0a0a] text-white border-2 border-silver rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
                <div className="bg-muted/50 p-4 border-b border-silver flex justify-between items-center">
                    <h2 className="text-xl font-black text-white flex items-center gap-2">
                        <i className="fas fa-calculator text-poke-accent"></i> Acquisition Wizard
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <i className="fas fa-times text-xl"></i>
                    </button>
                </div>

                <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">

                    <div className="bg-muted/30 p-3 rounded-lg border border-silver mb-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-bold text-poke-accent uppercase">Load Preset</label>
                            <button
                                onClick={() => setIsSavingPreset(!isSavingPreset)}
                                className="text-[10px] text-gray-600 hover:text-poke-accent underline"
                            >
                                {isSavingPreset ? 'Cancel Save' : 'Save Current as Preset'}
                            </button>
                        </div>

                        {!isSavingPreset ? (
                            <div className="flex gap-2">
                                <select
                                    value={selectedPresetId}
                                    onChange={(e) => loadPreset(e.target.value)}
                                    className="flex-1 bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-accent outline-none"
                                >
                                    <option value="">-- Select a Preset --</option>
                                    {presets.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                                {selectedPresetId && (
                                    <button
                                        onClick={() => deletePreset(parseInt(selectedPresetId))}
                                        className="text-poke-accent hover:opacity-80 px-2"
                                        title="Delete Preset"
                                    >
                                        <i className="fas fa-trash"></i>
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Preset Name (e.g. Costco Bundle)"
                                    className="flex-1 bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-accent outline-none"
                                    value={newPresetName}
                                    onChange={e => setNewPresetName(e.target.value)}
                                />
                                <button
                                    onClick={savePreset}
                                    className="bg-poke-blue text-white px-3 rounded text-xs font-bold hover:opacity-90"
                                >
                                    Save
                                </button>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-poke-accent uppercase mb-1">Source / Retailer</label>
                        <select
                            value={retailerId}
                            onChange={(e) => setRetailerId(e.target.value)}
                            className="w-full bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-accent outline-none mb-2"
                        >
                            <option value="">Select Retailer...</option>
                            {allRetailers.map(r => (
                                <option key={r.id} value={r.id}>{r.name} ({r.type || r.focus || 'Retail'})</option>
                            ))}
                            <option value="custom">Other / Custom...</option>
                        </select>
                        {retailerId === 'custom' && (
                            <input
                                type="text"
                                placeholder="Enter Store Name"
                                className="w-full bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-accent outline-none"
                                value={customRetailer}
                                onChange={e => setCustomRetailer(e.target.value)}
                            />
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-poke-accent uppercase mb-1">Package Type</label>
                        <select
                            value={packageType}
                            onChange={(e) => setPackageType(e.target.value)}
                            className="w-full bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-accent outline-none"
                        >
                            <option value="">Select Source Type...</option>
                            <optgroup label="English / International">
                                {packData.pokemon_tcg_data.english_international.map(p => (
                                    <option key={p.package_type} value={p.package_type}>{p.package_type} ({p.total_scannable_cards} Cards)</option>
                                ))}
                            </optgroup>
                            <optgroup label="Japanese OCG">
                                {packData.pokemon_tcg_data.japanese_ocg.map(p => (
                                    <option key={p.package_type} value={p.package_type}>{p.package_type} ({p.total_scannable_cards} Cards)</option>
                                ))}
                            </optgroup>
                            <optgroup label="Specialty">
                                {packData.pokemon_tcg_data.promotional_specialty.map(p => (
                                    <option key={p.package_type} value={p.package_type}>{p.package_type} ({p.total_scannable_cards} Cards)</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Qty Purchased</label>
                            <input
                                type="number"
                                min="1"
                                className="w-full bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-accent outline-none"
                                value={quantity}
                                onChange={e => setQuantity(parseInt(e.target.value) || 1)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Total Paid ($)</label>
                            <input
                                type="number"
                                placeholder="0.00"
                                className="w-full bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-accent outline-none"
                                value={totalPrice}
                                onChange={e => setTotalPrice(e.target.value)}
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="checkbox"
                                id="addTaxShip"
                                checked={useTaxShipping}
                                onChange={e => setUseTaxShipping(e.target.checked)}
                                className="w-4 h-4 rounded border-gray-400 bg-[#050505] text-poke-accent focus:ring-poke-accent"
                            />
                            <label htmlFor="addTaxShip" className="text-xs text-gray-600">Include Tax & Shipping in Unit Calculation</label>
                        </div>

                        {useTaxShipping && (
                            <div className="grid grid-cols-2 gap-4 animate-fade-in">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Total Tax ($)</label>
                                    <input
                                        type="number"
                                        placeholder="0.00"
                                        className="w-full bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-accent outline-none"
                                        value={totalTax}
                                        onChange={e => setTotalTax(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Total Shipping ($)</label>
                                    <input
                                        type="number"
                                        placeholder="0.00"
                                        className="w-full bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-accent outline-none"
                                        value={totalShipping}
                                        onChange={e => setTotalShipping(e.target.value)}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {packageType && totalPrice && (
                        <div className="bg-poke-accent/10 border border-poke-accent/30 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-poke-accent uppercase font-bold mb-1">Estimated Cost Per Scan</p>
                            <div className="text-2xl font-black text-white">
                                ${((
                                    (parseFloat(totalPrice) || 0) +
                                    (useTaxShipping ? (parseFloat(totalTax) || 0) : 0) +
                                    (useTaxShipping ? (parseFloat(totalShipping) || 0) : 0)
                                ) / (quantity * (allPackTypes.find(p => p.package_type === packageType)?.total_scannable_cards || 1))).toFixed(2)}
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1">
                                Based on {quantity}x {packageType} ({quantity * (allPackTypes.find(p => p.package_type === packageType)?.total_scannable_cards || 1)} Total Cards)
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 border-t border-silver pt-4 mt-2">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Tracking Number</label>
                            <input
                                type="text"
                                placeholder="e.g. 1Z99999999"
                                className="w-full bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-blue outline-none"
                                value={trackingNumber}
                                onChange={e => setTrackingNumber(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Order / Receipt ID</label>
                            <input
                                type="text"
                                placeholder="e.g. 123-4567890"
                                className="w-full bg-[#050505] border border-silver rounded p-2 text-white text-sm focus:border-poke-blue outline-none"
                                value={orderId}
                                onChange={e => setOrderId(e.target.value)}
                            />
                        </div>
                    </div>

                </div>

                <div className="p-4 bg-muted/30 border-t border-silver flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded text-gray-400 hover:text-white text-sm font-bold">Cancel</button>
                    <button
                        onClick={handleApply}
                        className="px-6 py-2 bg-poke-accent text-white rounded font-black text-sm hover:opacity-90 transition-all shadow"
                    >
                        Apply to Record
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AcquisitionWizard;
