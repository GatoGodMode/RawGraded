import React, { useEffect, useState } from 'react';
import Card3DViewer from './Card3DViewer';

type Public3DResponse = {
  success: boolean;
  cert_id: string;
  front_texture: string;
  back_texture: string;
  height_grid_json: string; // stored JSON string
  height_grid_meta?: any;
  is_holographic?: boolean;
  holo_pattern?: string;
  year?: string;
  card_set?: string;
};

export default function PublicCard3DView({ token }: { token: string; onBack?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Public3DResponse | null>(null);

  const parseHeightGridStrength = (meta: any): number | undefined => {
    if (meta == null) return undefined;
    if (typeof meta === 'string') {
      try {
        const parsed = JSON.parse(meta);
        const s = parsed?.strength;
        return typeof s === 'number' && Number.isFinite(s) ? s : (s != null ? Number(s) : undefined);
      } catch {
        return undefined;
      }
    }
    const s = meta?.strength;
    if (typeof s === 'number' && Number.isFinite(s)) return s;
    if (s != null) return Number(s);
    return undefined;
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const res = await fetch(`api/plugin_3d_card.php?action=public_view&token=${encodeURIComponent(token)}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Failed to load 3D card.');
        if (!alive) return;
        setData(json as Public3DResponse);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#111111] text-white">
        <div className="text-center">
          <div className="text-[#D4AF37] font-black uppercase tracking-widest">Loading 3D…</div>
          <div className="text-white/40 text-sm mt-2">Preparing textures and normal map.</div>
        </div>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#111111] text-white p-6 text-center">
        <div>
          <div className="text-red-500 text-2xl font-black">3D unavailable</div>
          <div className="text-white/50 mt-3 text-sm">{err || 'Could not load 3D.'}</div>
          <div className="text-white/30 mt-2 text-xs">Ask the card owner to enable 3D for this card.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111111] text-white flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <div className="font-black uppercase tracking-widest text-[#D4AF37] text-xs">3D Card View</div>
          <div className="text-white/40 text-xs">{data.cert_id.slice(0, 10)}…</div>
        </div>
        <Card3DViewer
          frontTexture={data.front_texture}
          backTexture={data.back_texture}
          heightGridJson={data.height_grid_json}
          isHolographic={Boolean(data.is_holographic)}
          holoPattern={data.holo_pattern ?? 'none'}
          year={data.year ?? null}
          cardSet={data.card_set ?? null}
          normalStrength={parseHeightGridStrength(data.height_grid_meta) ?? undefined}
          showLightingControls={true}
          className="w-full max-w-[320px] sm:max-w-[500px] mx-auto"
        />
      </div>
    </div>
  );
}

