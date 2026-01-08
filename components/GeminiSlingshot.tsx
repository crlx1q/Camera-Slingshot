/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Point, Bubble, Particle, BubbleColor } from '../types';
import { Loader2, Trophy, Play, Monitor } from 'lucide-react';

const PINCH_THRESHOLD = 0.05;
const GRAVITY = 0.0; 
const FRICTION = 0.998; 

const BUBBLE_RADIUS = 22;
const ROW_HEIGHT = BUBBLE_RADIUS * Math.sqrt(3);
const GRID_COLS = 12;
const GRID_ROWS = 8;
const SLINGSHOT_BOTTOM_OFFSET = 220;

const MAX_DRAG_DIST = 180;
const MIN_FORCE_MULT = 0.15;
const MAX_FORCE_MULT = 0.45;

// Material Design Colors & Scoring Strategy
const COLOR_CONFIG: Record<BubbleColor, { hex: string, points: number, label: string }> = {
  red:    { hex: '#ef5350', points: 100, label: 'Red' },     // Material Red 400
  blue:   { hex: '#42a5f5', points: 150, label: 'Blue' },    // Material Blue 400
  green:  { hex: '#66bb6a', points: 200, label: 'Green' },   // Material Green 400
  yellow: { hex: '#ffee58', points: 250, label: 'Yellow' },  // Material Yellow 400
  purple: { hex: '#ab47bc', points: 300, label: 'Purple' },  // Material Purple 400
  orange: { hex: '#ffa726', points: 500, label: 'Orange' }   // Material Orange 400
};

const COLOR_KEYS: BubbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

// Color Helper for Gradients
const adjustColor = (color: string, amount: number) => {
    const hex = color.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(hex.substring(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.substring(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.substring(4, 6), 16) + amount));
    
    const componentToHex = (c: number) => {
        const hex = c.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    };
    
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

const GeminiSlingshot: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  
  // Game State Refs
  const ballPos = useRef<Point>({ x: 0, y: 0 });
  const ballVel = useRef<Point>({ x: 0, y: 0 });
  const anchorPos = useRef<Point>({ x: 0, y: 0 });
  const isPinching = useRef<boolean>(false);
  const isFlying = useRef<boolean>(false);
  const flightStartTime = useRef<number>(0);
  const bubbles = useRef<Bubble[]>([]);
  const particles = useRef<Particle[]>([]);
  const scoreRef = useRef<number>(0);
  
  // Color Queue Refs
  const currentColorRef = useRef<BubbleColor>('red');
  const nextColorRef = useRef<BubbleColor>('blue');
  
  // React State for UI
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState(0);
  const [currentColor, setCurrentColor] = useState<BubbleColor>('red');
  const [nextColor, setNextColor] = useState<BubbleColor>('blue');
  
  // Sync state to ref
  useEffect(() => {
    // We primarily drive from Refs for game loop, but sync to State for UI.
    // This effect ensures if we manually set state it updates refs (mostly for init).
    // In main loop, we update refs then set state.
  }, []);
  
  const getBubblePos = (row: number, col: number, width: number) => {
    const xOffset = (width - (GRID_COLS * BUBBLE_RADIUS * 2)) / 2 + BUBBLE_RADIUS;
    const isOdd = row % 2 !== 0;
    const x = xOffset + col * (BUBBLE_RADIUS * 2) + (isOdd ? BUBBLE_RADIUS : 0);
    const y = BUBBLE_RADIUS + row * ROW_HEIGHT;
    return { x, y };
  };

  const initGrid = useCallback((width: number) => {
    const newBubbles: Bubble[] = [];
    for (let r = 0; r < 5; r++) { 
      for (let c = 0; c < (r % 2 !== 0 ? GRID_COLS - 1 : GRID_COLS); c++) {
        if (Math.random() > 0.1) {
            const { x, y } = getBubblePos(r, c, width);
            newBubbles.push({
              id: `${r}-${c}`,
              row: r,
              col: c,
              x,
              y,
              color: COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)],
              active: true
            });
        }
      }
    }
    bubbles.current = newBubbles;
    
    // Initialize Color Queue based on board content
    const activeColors = new Set<BubbleColor>();
    newBubbles.forEach(b => activeColors.add(b.color));
    const options = Array.from(activeColors);
    
    const pick = () => options.length > 0 ? options[Math.floor(Math.random() * options.length)] : COLOR_KEYS[0];
    
    const c1 = pick();
    const c2 = pick();
    
    currentColorRef.current = c1;
    nextColorRef.current = c2;
    setCurrentColor(c1);
    setNextColor(c2);
  }, []);

  const createExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 15; i++) {
      particles.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.5) * 12,
        life: 1.0,
        color
      });
    }
  };

  const checkMatches = (startBubble: Bubble) => {
    const toCheck = [startBubble];
    const visited = new Set<string>();
    const matches: Bubble[] = [];
    const targetColor = startBubble.color;

    while (toCheck.length > 0) {
      const current = toCheck.pop()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      if (current.color === targetColor) {
        matches.push(current);
        const neighbors = bubbles.current.filter(b => b.active && !visited.has(b.id) && isNeighbor(current, b));
        toCheck.push(...neighbors);
      }
    }

    if (matches.length >= 3) {
      let points = 0;
      const basePoints = COLOR_CONFIG[targetColor].points;
      
      matches.forEach(b => {
        b.active = false;
        createExplosion(b.x, b.y, COLOR_CONFIG[b.color].hex);
        points += basePoints;
      });
      // Combo Multiplier
      const multiplier = matches.length > 3 ? 1.5 : 1.0;
      scoreRef.current += Math.floor(points * multiplier);
      // setScore is handled in main loop
      return true;
    }
    return false;
  };

  const isNeighbor = (a: Bubble, b: Bubble) => {
    const dr = b.row - a.row;
    const dc = b.col - a.col;
    if (Math.abs(dr) > 1) return false;
    if (dr === 0) return Math.abs(dc) === 1;
    if (a.row % 2 !== 0) {
        return dc === 0 || dc === 1;
    } else {
        return dc === -1 || dc === 0;
    }
  };

  // --- Rendering Helper ---
  const drawBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, colorKey: BubbleColor) => {
    const config = COLOR_CONFIG[colorKey];
    const baseColor = config.hex;
    
    // Shadow for better visibility over video
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;

    // Main Sphere Gradient
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    grad.addColorStop(0, '#ffffff');             // Specular highlight center
    grad.addColorStop(0.2, baseColor);           // Main color body
    grad.addColorStop(1, adjustColor(baseColor, -60)); // Shadowed edge

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore(); // remove shadow for stroke

    // Subtle Outline for definition
    ctx.strokeStyle = adjustColor(baseColor, -80);
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Secondary "Glossy" Highlight
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.3, y - radius * 0.35, radius * 0.25, radius * 0.15, Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fill();
  };

  // --- Main Game Loop ---

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current || !gameContainerRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const container = gameContainerRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Set initial size based on container
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    anchorPos.current = { x: canvas.width / 2, y: canvas.height - SLINGSHOT_BOTTOM_OFFSET };
    ballPos.current = { ...anchorPos.current };
    
    initGrid(canvas.width);

    let camera: any = null;
    let hands: any = null;

    const onResults = (results: any) => {
      setLoading(false);
      
      // Responsive Resize
      if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        anchorPos.current = { x: canvas.width / 2, y: canvas.height - SLINGSHOT_BOTTOM_OFFSET };
        if (!isFlying.current && !isPinching.current) {
          ballPos.current = { ...anchorPos.current };
        }
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw Video Feed - NO Dark Overlay
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      // --- Hand Tracking ---
      let handPos: Point | null = null;
      let pinchDist = 1.0;

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const idxTip = landmarks[8];
        const thumbTip = landmarks[4];

        handPos = {
          x: (idxTip.x * canvas.width + thumbTip.x * canvas.width) / 2,
          y: (idxTip.y * canvas.height + thumbTip.y * canvas.height) / 2
        };

        const dx = idxTip.x - thumbTip.x;
        const dy = idxTip.y - thumbTip.y;
        pinchDist = Math.sqrt(dx * dx + dy * dy);

        if (window.drawConnectors && window.drawLandmarks) {
           // Brighter colors for visibility over raw video
           window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, {color: '#669df6', lineWidth: 1});
           window.drawLandmarks(ctx, landmarks, {color: '#aecbfa', lineWidth: 1, radius: 2});
        }
        
        // Cursor
        ctx.beginPath();
        ctx.arc(handPos.x, handPos.y, 20, 0, Math.PI * 2);
        ctx.strokeStyle = pinchDist < PINCH_THRESHOLD ? '#66bb6a' : '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      // --- SLINGSHOT LOGIC ---
      
      if (handPos && pinchDist < PINCH_THRESHOLD && !isFlying.current) {
        const distToBall = Math.sqrt(Math.pow(handPos.x - ballPos.current.x, 2) + Math.pow(handPos.y - ballPos.current.y, 2));
        if (!isPinching.current && distToBall < 100) {
           isPinching.current = true;
        }
        
        if (isPinching.current) {
            ballPos.current = { x: handPos.x, y: handPos.y };
            const dragDx = ballPos.current.x - anchorPos.current.x;
            const dragDy = ballPos.current.y - anchorPos.current.y;
            const dragDist = Math.sqrt(dragDx*dragDx + dragDy*dragDy);
            
            if (dragDist > MAX_DRAG_DIST) {
                const angle = Math.atan2(dragDy, dragDx);
                ballPos.current.x = anchorPos.current.x + Math.cos(angle) * MAX_DRAG_DIST;
                ballPos.current.y = anchorPos.current.y + Math.sin(angle) * MAX_DRAG_DIST;
            }
        }
      } 
      else if (isPinching.current && (!handPos || pinchDist >= PINCH_THRESHOLD)) {
        // Release
        isPinching.current = false;
        
        const dx = anchorPos.current.x - ballPos.current.x;
        const dy = anchorPos.current.y - ballPos.current.y;
        const stretchDist = Math.sqrt(dx*dx + dy*dy);
        
        if (stretchDist > 30) {
            isFlying.current = true;
            flightStartTime.current = performance.now();
            const powerRatio = Math.min(stretchDist / MAX_DRAG_DIST, 1.0);
            const velocityMultiplier = MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (powerRatio * powerRatio);

            ballVel.current = {
                x: dx * velocityMultiplier,
                y: dy * velocityMultiplier
            };
        } else {
            ballPos.current = { ...anchorPos.current };
        }
      }
      else if (!isFlying.current && !isPinching.current) {
          const dx = anchorPos.current.x - ballPos.current.x;
          const dy = anchorPos.current.y - ballPos.current.y;
          ballPos.current.x += dx * 0.15;
          ballPos.current.y += dy * 0.15;
      }

      // --- Physics ---
      if (isFlying.current) {
        // Infinite bounce safeguard
        if (performance.now() - flightStartTime.current > 5000) {
            isFlying.current = false;
            ballPos.current = { ...anchorPos.current };
            ballVel.current = { x: 0, y: 0 };
        } else {
            const currentSpeed = Math.sqrt(ballVel.current.x ** 2 + ballVel.current.y ** 2);
            const steps = Math.ceil(currentSpeed / (BUBBLE_RADIUS * 0.8)); 
            let collisionOccurred = false;

            for (let i = 0; i < steps; i++) {
                ballPos.current.x += ballVel.current.x / steps;
                ballPos.current.y += ballVel.current.y / steps;
                
                if (ballPos.current.x < BUBBLE_RADIUS || ballPos.current.x > canvas.width - BUBBLE_RADIUS) {
                    ballVel.current.x *= -1;
                    ballPos.current.x = Math.max(BUBBLE_RADIUS, Math.min(canvas.width - BUBBLE_RADIUS, ballPos.current.x));
                }

                if (ballPos.current.y < BUBBLE_RADIUS) {
                    collisionOccurred = true;
                    break;
                }

                for (const b of bubbles.current) {
                    if (!b.active) continue;
                    const dist = Math.sqrt(
                        Math.pow(ballPos.current.x - b.x, 2) + 
                        Math.pow(ballPos.current.y - b.y, 2)
                    );
                    if (dist < BUBBLE_RADIUS * 1.8) { 
                        collisionOccurred = true;
                        break;
                    }
                }
                if (collisionOccurred) break;
            }

            ballVel.current.y += GRAVITY; 
            ballVel.current.x *= FRICTION;
            ballVel.current.y *= FRICTION;

            if (collisionOccurred) {
                isFlying.current = false;
                
                let bestDist = Infinity;
                let bestRow = 0;
                let bestCol = 0;
                let bestX = 0;
                let bestY = 0;

                for (let r = 0; r < GRID_ROWS + 5; r++) {
                    const colsInRow = r % 2 !== 0 ? GRID_COLS - 1 : GRID_COLS;
                    for (let c = 0; c < colsInRow; c++) {
                        const { x, y } = getBubblePos(r, c, canvas.width);
                        const occupied = bubbles.current.some(b => b.active && b.row === r && b.col === c);
                        if (occupied) continue;

                        const dist = Math.sqrt(
                            Math.pow(ballPos.current.x - x, 2) + 
                            Math.pow(ballPos.current.y - y, 2)
                        );
                        
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestRow = r;
                            bestCol = c;
                            bestX = x;
                            bestY = y;
                        }
                    }
                }

                const newBubble: Bubble = {
                    id: `${bestRow}-${bestCol}-${Date.now()}`,
                    row: bestRow,
                    col: bestCol,
                    x: bestX,
                    y: bestY,
                    color: currentColorRef.current,
                    active: true
                };
                bubbles.current.push(newBubble);
                checkMatches(newBubble);
                
                // --- CYCLE COLORS ---
                // Get remaining active colors on board
                const remainingColors = new Set<BubbleColor>();
                bubbles.current.forEach(b => { if (b.active) remainingColors.add(b.color); });
                const options = Array.from(remainingColors);
                const validOptions = options.length > 0 ? options : COLOR_KEYS;

                // Move Next -> Current
                currentColorRef.current = nextColorRef.current;
                
                // Pick New Next
                nextColorRef.current = validOptions[Math.floor(Math.random() * validOptions.length)];
                
                // Sync State
                setScore(scoreRef.current);
                setCurrentColor(currentColorRef.current);
                setNextColor(nextColorRef.current);
                
                // Reset shot
                ballPos.current = { ...anchorPos.current };
                ballVel.current = { x: 0, y: 0 };
            }
            
            if (ballPos.current.y > canvas.height) {
                isFlying.current = false;
                ballPos.current = { ...anchorPos.current };
                ballVel.current = { x: 0, y: 0 };
            }
        }
      }

      // --- Drawing ---
      
      // Draw Grid Bubbles
      bubbles.current.forEach(b => {
          if (!b.active) return;
          drawBubble(ctx, b.x, b.y, BUBBLE_RADIUS - 1, b.color);
      });

      // --- Trajectory Line ---
      if (isPinching.current && !isFlying.current) {
          ctx.save();
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.lineWidth = 4;
          ctx.setLineDash([10, 10]);

          // Calculate launch vector (opposite to drag)
          const dx = anchorPos.current.x - ballPos.current.x;
          const dy = anchorPos.current.y - ballPos.current.y;
          const stretchDist = Math.sqrt(dx*dx + dy*dy);
          const powerRatio = Math.min(stretchDist / MAX_DRAG_DIST, 1.0);
          const velocityMultiplier = MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (powerRatio * powerRatio);
          
          let tX = anchorPos.current.x;
          let tY = anchorPos.current.y;
          let tVx = dx * velocityMultiplier;
          let tVy = dy * velocityMultiplier;

          ctx.moveTo(tX, tY);

          // Simulate trajectory (approx 60 frames)
          for (let i = 0; i < 60; i++) {
              tX += tVx;
              tY += tVy;
              
              // Wall Bounce
              if (tX < BUBBLE_RADIUS || tX > canvas.width - BUBBLE_RADIUS) {
                  tVx *= -1;
                  tX = Math.max(BUBBLE_RADIUS, Math.min(canvas.width - BUBBLE_RADIUS, tX));
              }

              // Ceiling/Bubble Collision Check
              let collision = false;
              if (tY < BUBBLE_RADIUS) collision = true;
              
              for (const b of bubbles.current) {
                  if (!b.active) continue;
                  const distSq = (tX - b.x)**2 + (tY - b.y)**2;
                  if (distSq < (BUBBLE_RADIUS * 1.8)**2) {
                      collision = true;
                      break;
                  }
              }

              ctx.lineTo(tX, tY);

              if (collision) {
                  // Draw impact point marker
                  ctx.stroke();
                  ctx.beginPath();
                  ctx.arc(tX, tY, 5, 0, Math.PI * 2);
                  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                  ctx.fill();
                  break;
              }
          }
          ctx.stroke();
          ctx.restore();
      }

      // Slingshot Band (Back)
      const bandColor = isPinching.current ? '#fdd835' : 'rgba(255,255,255,0.4)';
      if (!isFlying.current) {
        ctx.beginPath();
        ctx.moveTo(anchorPos.current.x - 35, anchorPos.current.y - 10);
        ctx.lineTo(ballPos.current.x, ballPos.current.y);
        ctx.lineWidth = 5;
        ctx.strokeStyle = bandColor;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Draw Slingshot Ball (Projectile)
      drawBubble(ctx, ballPos.current.x, ballPos.current.y, BUBBLE_RADIUS, currentColorRef.current);

      // Slingshot Band (Front)
      if (!isFlying.current) {
        ctx.beginPath();
        ctx.moveTo(ballPos.current.x, ballPos.current.y);
        ctx.lineTo(anchorPos.current.x + 35, anchorPos.current.y - 10);
        ctx.lineWidth = 5;
        ctx.strokeStyle = bandColor;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Slingshot Handle
      ctx.beginPath();
      ctx.moveTo(anchorPos.current.x, canvas.height); 
      ctx.lineTo(anchorPos.current.x, anchorPos.current.y + 40); 
      ctx.lineTo(anchorPos.current.x - 40, anchorPos.current.y); 
      ctx.moveTo(anchorPos.current.x, anchorPos.current.y + 40);
      ctx.lineTo(anchorPos.current.x + 40, anchorPos.current.y); 
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#616161';
      ctx.stroke();

      // Particles
      for (let i = particles.current.length - 1; i >= 0; i--) {
          const p = particles.current[i];
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.05;
          if (p.life <= 0) particles.current.splice(i, 1);
          else {
              ctx.globalAlpha = p.life;
              ctx.beginPath();
              ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
              ctx.fillStyle = p.color;
              ctx.fill();
              ctx.globalAlpha = 1.0;
          }
      }
      
      ctx.restore();
    };

    if (window.Hands) {
      hands = new window.Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      hands.onResults(onResults);
      if (window.Camera) {
        camera = new window.Camera(video, {
          onFrame: async () => {
            if (videoRef.current && hands) await hands.send({ image: videoRef.current });
          },
          width: 1280,
          height: 720,
        });
        camera.start();
      }
    }

    return () => {
        if (camera) camera.stop();
        if (hands) hands.close();
    };
  }, [initGrid]);

  return (
    <div className="w-full h-screen bg-[#121212] overflow-hidden font-roboto text-[#e3e3e3]">
      
      {/* MOBILE/TABLET BLOCKER OVERLAY */}
      <div className="fixed inset-0 z-[100] bg-[#121212] flex flex-col items-center justify-center p-8 text-center md:hidden">
         <Monitor className="w-16 h-16 text-[#ef5350] mb-6 animate-pulse" />
         <h2 className="text-2xl font-bold text-[#e3e3e3] mb-4">Desktop View Required</h2>
         <p className="text-[#c4c7c5] max-w-md text-lg leading-relaxed">
           This experience requires a larger screen for the webcam tracking and game mechanics.
         </p>
         <div className="mt-8 flex items-center gap-2 text-sm text-[#757575] uppercase tracking-wider font-bold">
           <div className="w-2 h-2 bg-[#42a5f5] rounded-full"></div>
           Please maximize window
         </div>
      </div>

      {/* Game Area - Full Screen */}
      <div ref={gameContainerRef} className="w-full h-full relative overflow-hidden">
        <video ref={videoRef} className="absolute hidden" playsInline />
        <canvas ref={canvasRef} className="absolute inset-0" />

        {/* Loading Overlay */}
        {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#121212] z-50">
            <div className="flex flex-col items-center">
                <Loader2 className="w-12 h-12 text-[#42a5f5] animate-spin mb-4" />
                <p className="text-[#e3e3e3] text-lg font-medium">Initializing Vision...</p>
            </div>
            </div>
        )}

        {/* HUD: Score Card */}
        <div className="absolute top-6 left-6 z-40">
            <div className="bg-[#1e1e1e] p-5 rounded-[28px] border border-[#444746] shadow-2xl flex items-center gap-4 min-w-[180px]">
                <div className="bg-[#42a5f5]/20 p-3 rounded-full">
                    <Trophy className="w-6 h-6 text-[#42a5f5]" />
                </div>
                <div>
                    <p className="text-xs text-[#c4c7c5] uppercase tracking-wider font-medium">Score</p>
                    <p className="text-3xl font-bold text-white">{score.toLocaleString()}</p>
                </div>
            </div>
        </div>

        {/* HUD: Next Bubble Indicator */}
        <div className="absolute bottom-6 left-6 z-40">
            <div className="bg-[#1e1e1e] px-5 py-4 rounded-[28px] border border-[#444746] shadow-2xl flex items-center gap-4">
                 <p className="text-xs text-[#c4c7c5] uppercase tracking-wider font-bold">Next</p>
                 <div className="relative">
                    <div 
                        className="w-12 h-12 rounded-full shadow-lg border-2 border-white/10"
                        style={{
                            background: `radial-gradient(circle at 35% 35%, ${COLOR_CONFIG[nextColor].hex}, ${adjustColor(COLOR_CONFIG[nextColor].hex, -60)})`,
                            boxShadow: `0 4px 8px rgba(0,0,0,0.4)`
                        }}
                    >
                        <div className="absolute top-2 left-3 w-4 h-2 bg-white/30 rounded-full transform -rotate-45 filter blur-[1px]" />
                    </div>
                 </div>
            </div>
        </div>

        {/* Bottom Tip */}
        {!isPinching.current && !isFlying.current && (
            <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 pointer-events-none opacity-50">
                <div className="flex items-center gap-2 bg-[#1e1e1e]/90 px-4 py-2 rounded-full border border-[#444746] backdrop-blur-sm">
                    <Play className="w-3 h-3 text-[#42a5f5] fill-current" />
                    <p className="text-[#e3e3e3] text-xs font-medium">Pinch & Pull to Shoot</p>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default GeminiSlingshot;