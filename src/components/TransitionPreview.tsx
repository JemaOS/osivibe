// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';
import { TransitionType } from '../types';

interface TransitionPreviewProps {
  type: TransitionType;
  className?: string;
}

export const TransitionPreview: React.FC<TransitionPreviewProps> = ({ type, className = '' }) => {
  const uniqueId = React.useId();
  
  const renderPreview = () => {
    const baseProps = {
      width: "100%",
      height: "100%",
      viewBox: "0 0 100 60",
      className: "transition-preview-svg"
    };

    switch (type) {
      case 'none':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="100" height="60" fill="#E8EAF0" />
            <text x="50" y="35" textAnchor="middle" fill="#6B7280" fontSize="12" fontFamily="Inter">Aucune</text>
          </svg>
        );
      
      case 'fade':
      case 'dissolve':
      case 'cross-dissolve':
        return (
          <svg {...baseProps}>
            <defs>
              <linearGradient id={`fade-grad-${uniqueId}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style={{ stopColor: '#757AED', stopOpacity: 0 }} />
                <stop offset="100%" style={{ stopColor: '#757AED', stopOpacity: 1 }} />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="100" height="60" fill={`url(#fade-grad-${uniqueId})`} />
          </svg>
        );
      
      case 'slide-left':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="50" height="60" fill="#E8EAF0" />
            <rect x="50" y="0" width="50" height="60" fill="#757AED" />
            <path d="M 50 30 L 45 25 L 45 35 Z" fill="#FFFFFF" />
          </svg>
        );
      
      case 'slide-right':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="50" height="60" fill="#757AED" />
            <rect x="50" y="0" width="50" height="60" fill="#E8EAF0" />
            <path d="M 50 30 L 55 25 L 55 35 Z" fill="#FFFFFF" />
          </svg>
        );
      
      case 'slide-up':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="100" height="30" fill="#E8EAF0" />
            <rect x="0" y="30" width="100" height="30" fill="#757AED" />
            <path d="M 50 30 L 45 25 L 55 25 Z" fill="#FFFFFF" />
          </svg>
        );
      
      case 'slide-down':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="100" height="30" fill="#757AED" />
            <rect x="0" y="30" width="100" height="30" fill="#E8EAF0" />
            <path d="M 50 30 L 45 35 L 55 35 Z" fill="#FFFFFF" />
          </svg>
        );
      
      case 'slide-diagonal-tl':
        return (
          <svg {...baseProps}>
            <polygon points="0,0 100,0 0,60" fill="#E8EAF0" />
            <polygon points="100,0 100,60 0,60" fill="#757AED" />
            <path d="M 50 30 L 45 25 L 50 20 Z" fill="#FFFFFF" />
          </svg>
        );
      
      case 'slide-diagonal-tr':
        return (
          <svg {...baseProps}>
            <polygon points="0,0 100,0 100,60" fill="#E8EAF0" />
            <polygon points="0,0 0,60 100,60" fill="#757AED" />
            <path d="M 50 30 L 55 25 L 50 20 Z" fill="#FFFFFF" />
          </svg>
        );
      
      case 'wipe-left':
      case 'wipe-right':
      case 'wipe-up':
      case 'wipe-down':
        const isHorizontal = type.includes('left') || type.includes('right');
        const firstHalf = type.includes('left') || type.includes('up');
        return (
          <svg {...baseProps}>
            {isHorizontal ? (
              <>
                <rect x="0" y="0" width="60" height="60" fill={firstHalf ? "#E8EAF0" : "#757AED"} />
                <rect x="60" y="0" width="40" height="60" fill={firstHalf ? "#757AED" : "#E8EAF0"} />
                <line x1="60" y1="0" x2="60" y2="60" stroke="#FFFFFF" strokeWidth="2" />
              </>
            ) : (
              <>
                <rect x="0" y="0" width="100" height="36" fill={firstHalf ? "#E8EAF0" : "#757AED"} />
                <rect x="0" y="36" width="100" height="24" fill={firstHalf ? "#757AED" : "#E8EAF0"} />
                <line x1="0" y1="36" x2="100" y2="36" stroke="#FFFFFF" strokeWidth="2" />
              </>
            )}
          </svg>
        );
      
      case 'zoom-in':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="100" height="60" fill="#E8EAF0" />
            <rect x="30" y="18" width="40" height="24" fill="#757AED" />
            <circle cx="50" cy="30" r="15" fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeDasharray="2,2" />
          </svg>
        );
      
      case 'zoom-out':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="100" height="60" fill="#757AED" />
            <rect x="30" y="18" width="40" height="24" fill="#E8EAF0" />
            <circle cx="50" cy="30" r="25" fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeDasharray="2,2" />
          </svg>
        );
      
      case 'rotate-in':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="100" height="60" fill="#E8EAF0" />
            <rect x="30" y="15" width="40" height="30" fill="#757AED" transform="rotate(15 50 30)" />
            <path d="M 70 25 Q 75 20 75 15" fill="none" stroke="#FFFFFF" strokeWidth="2" />
            <path d="M 75 15 L 72 18 L 77 20" fill="#FFFFFF" />
          </svg>
        );
      
      case 'rotate-out':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="100" height="60" fill="#757AED" />
            <rect x="30" y="15" width="40" height="30" fill="#E8EAF0" transform="rotate(-15 50 30)" />
            <path d="M 30 25 Q 25 20 25 15" fill="none" stroke="#FFFFFF" strokeWidth="2" />
            <path d="M 25 15 L 28 18 L 23 20" fill="#FFFFFF" />
          </svg>
        );
      
      case 'circle-wipe':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="100" height="60" fill="#E8EAF0" />
            <circle cx="50" cy="30" r="20" fill="#757AED" />
            <circle cx="50" cy="30" r="20" fill="none" stroke="#FFFFFF" strokeWidth="2" />
          </svg>
        );
      
      case 'diamond-wipe':
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="100" height="60" fill="#E8EAF0" />
            <polygon points="50,10 70,30 50,50 30,30" fill="#757AED" />
            <polygon points="50,10 70,30 50,50 30,30" fill="none" stroke="#FFFFFF" strokeWidth="2" />
          </svg>
        );
      
      default:
        return (
          <svg {...baseProps}>
            <rect x="0" y="0" width="100" height="60" fill="#E8EAF0" />
          </svg>
        );
    }
  };

  return (
    <div className={`transition-preview w-full h-full rounded-lg overflow-hidden bg-neutral-100 ${className}`}>
      {renderPreview()}
    </div>
  );
};

export default TransitionPreview;
