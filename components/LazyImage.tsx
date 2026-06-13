import React, { useState, useEffect } from 'react';
import { lazyImageStore } from '../services/lazyImageStore';

interface LazyImageProps {
    id: string;
    userId: string;
    alt?: string;
    className?: string;
}

const LazyImage: React.FC<LazyImageProps> = ({ id, userId, alt, className }) => {
    const [src, setSrc] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        const loadImage = async () => {
            setLoading(true);
            try {
                const images = await lazyImageStore.fetchAndCache(id, userId);
                if (isMounted) {
                    setSrc(images.front);
                }
            } catch (error) {
                console.error('Error loading lazy image:', error);
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        loadImage();
        return () => {
            isMounted = false;
        };
    }, [id, userId]);

    if (loading) {
        return <div className={`animate-pulse bg-gray-800 ${className}`} />;
    }

    if (!src) {
        return <div className={`bg-gray-900 flex items-center justify-center ${className}`}>
            <span className="text-[10px] text-gray-600">No Image</span>
        </div>;
    }

    return (
        <img
            src={src}
            alt={alt || 'Card Image'}
            className={className}
            loading="lazy"
        />
    );
};

export default LazyImage;
