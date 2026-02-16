import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Game constants
const TILE_SIZE = 16;
const MAP_WIDTH = 20;
const MAP_HEIGHT = 15;
const PLAYER_SPEED = 2;

// Tile types
const TILES = {
  GRASS: 0,
  WALL: 1,
  WATER: 2,
  TREE: 3,
  BUSH: 4,
  PATH: 5,
  HEART: 6,
  RUPEE: 7,
};

// Colors for tiles
const TILE_COLORS: Record<number, string> = {
  [TILES.GRASS]: '#3d8b40',
  [TILES.WALL]: '#5a5a5a',
  [TILES.WATER]: '#4a90d9',
  [TILES.TREE]: '#2d5a2e',
  [TILES.BUSH]: '#4a7c4b',
  [TILES.PATH]: '#c4a35a',
  [TILES.HEART]: '#e74c3c',
  [TILES.RUPEE]: '#f1c40f',
};

// Generate initial map
const generateMap = (): number[][] => {
  const map: number[][] = [];
  
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const row: number[] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      // Border walls
      if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
        row.push(TILES.WALL);
      }
      // Random elements
      else if (Math.random() < 0.1) {
        row.push(TILES.TREE);
      } else if (Math.random() < 0.05) {
        row.push(TILES.BUSH);
      } else if (Math.random() < 0.03) {
        row.push(TILES.WATER);
      } else {
        row.push(TILES.GRASS);
      }
    }
    map.push(row);
  }
  
  // Clear spawn area
  for (let y = 6; y < 9; y++) {
    for (let x = 9; x < 12; x++) {
      map[y][x] = TILES.GRASS;
    }
  }
  
  // Add some paths
  for (let x = 2; x < MAP_WIDTH - 2; x++) {
    if (Math.random() < 0.7) map[7][x] = TILES.PATH;
  }
  
  // Add collectibles
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(Math.random() * (MAP_WIDTH - 4)) + 2;
    const y = Math.floor(Math.random() * (MAP_HEIGHT - 4)) + 2;
    if (map[y][x] === TILES.GRASS || map[y][x] === TILES.PATH) {
      map[y][x] = Math.random() < 0.5 ? TILES.HEART : TILES.RUPEE;
    }
  }
  
  return map;
};

interface Enemy {
  x: number;
  y: number;
  direction: number;
  speed: number;
}

interface Collectible {
  x: number;
  y: number;
  type: 'heart' | 'rupee';
}

const ZeldaGame: React.FC = () => {
  const { user, updateUserStats } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [health, setHealth] = useState(3);
  const [map, setMap] = useState<number[][]>([]);
  const [playerPos, setPlayerPos] = useState({ x: 10 * TILE_SIZE, y: 7 * TILE_SIZE });
  const [playerDirection, setPlayerDirection] = useState(0); // 0=down, 1=left, 2=right, 3=up
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [collectibles, setCollectibles] = useState<Collectible[]>([]);
  const [keys, setKeys] = useState<Set<string>>(new Set());
  
  const keysRef = useRef<Set<string>>(new Set());

  // Initialize game
  const initGame = useCallback(() => {
    const newMap = generateMap();
    setMap(newMap);
    setPlayerPos({ x: 10 * TILE_SIZE, y: 7 * TILE_SIZE });
    setHealth(3);
    setScore(0);
    setGameOver(false);
    
    // Create enemies
    const newEnemies: Enemy[] = [];
    for (let i = 0; i < 3; i++) {
      newEnemies.push({
        x: (Math.floor(Math.random() * 10) + 5) * TILE_SIZE,
        y: (Math.floor(Math.random() * 8) + 3) * TILE_SIZE,
        direction: Math.floor(Math.random() * 4),
        speed: 1,
      });
    }
    setEnemies(newEnemies);
    
    // Extract collectibles from map
    const newCollectibles: Collectible[] = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (newMap[y][x] === TILES.HEART) {
          newCollectibles.push({ x: x * TILE_SIZE, y: y * TILE_SIZE, type: 'heart' });
          newMap[y][x] = TILES.GRASS;
        } else if (newMap[y][x] === TILES.RUPEE) {
          newCollectibles.push({ x: x * TILE_SIZE, y: y * TILE_SIZE, type: 'rupee' });
          newMap[y][x] = TILES.GRASS;
        }
      }
    }
    setCollectibles(newCollectibles);
    setMap(newMap);
    setGameStarted(true);
  }, []);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) {
        e.preventDefault();
        keysRef.current.add(e.key.toLowerCase());
        setKeys(new Set(keysRef.current));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
      setKeys(new Set(keysRef.current));
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Check collision with walls
  const checkCollision = useCallback((x: number, y: number): boolean => {
    const tileX = Math.floor(x / TILE_SIZE);
    const tileY = Math.floor(y / TILE_SIZE);
    const tileX2 = Math.floor((x + TILE_SIZE - 1) / TILE_SIZE);
    const tileY2 = Math.floor((y + TILE_SIZE - 1) / TILE_SIZE);

    if (tileX < 0 || tileX2 >= MAP_WIDTH || tileY < 0 || tileY2 >= MAP_HEIGHT) return true;

    const solidTiles = [TILES.WALL, TILES.TREE, TILES.WATER];
    return (
      solidTiles.includes(map[tileY]?.[tileX]) ||
      solidTiles.includes(map[tileY]?.[tileX2]) ||
      solidTiles.includes(map[tileY2]?.[tileX]) ||
      solidTiles.includes(map[tileY2]?.[tileX2])
    );
  }, [map]);

  // Game loop
  useEffect(() => {
    if (!gameStarted || gameOver) return;

    const gameLoop = setInterval(() => {
      // Move player based on keys
      setPlayerPos((prev) => {
        let newX = prev.x;
        let newY = prev.y;

        if (keysRef.current.has('arrowup') || keysRef.current.has('w')) {
          newY -= PLAYER_SPEED;
          setPlayerDirection(3);
        }
        if (keysRef.current.has('arrowdown') || keysRef.current.has('s')) {
          newY += PLAYER_SPEED;
          setPlayerDirection(0);
        }
        if (keysRef.current.has('arrowleft') || keysRef.current.has('a')) {
          newX -= PLAYER_SPEED;
          setPlayerDirection(1);
        }
        if (keysRef.current.has('arrowright') || keysRef.current.has('d')) {
          newX += PLAYER_SPEED;
          setPlayerDirection(2);
        }

        if (!checkCollision(newX, newY)) {
          return { x: newX, y: newY };
        } else if (!checkCollision(newX, prev.y)) {
          return { x: newX, y: prev.y };
        } else if (!checkCollision(prev.x, newY)) {
          return { x: prev.x, y: newY };
        }
        return prev;
      });

      // Move enemies
      setEnemies((prevEnemies) =>
        prevEnemies.map((enemy) => {
          let newX = enemy.x;
          let newY = enemy.y;

          switch (enemy.direction) {
            case 0: newY += enemy.speed; break;
            case 1: newX -= enemy.speed; break;
            case 2: newX += enemy.speed; break;
            case 3: newY -= enemy.speed; break;
          }

          if (checkCollision(newX, newY)) {
            return { ...enemy, direction: Math.floor(Math.random() * 4) };
          }

          // Random direction change
          if (Math.random() < 0.02) {
            return { ...enemy, x: newX, y: newY, direction: Math.floor(Math.random() * 4) };
          }

          return { ...enemy, x: newX, y: newY };
        })
      );

      // Check collectible collision
      setCollectibles((prev) => {
        return prev.filter((c) => {
          const dx = Math.abs(c.x - playerPos.x);
          const dy = Math.abs(c.y - playerPos.y);
          if (dx < TILE_SIZE && dy < TILE_SIZE) {
            if (c.type === 'heart') {
              setHealth((h) => Math.min(h + 1, 5));
            } else {
              setScore((s) => s + 10);
            }
            return false;
          }
          return true;
        });
      });

      // Check enemy collision
      enemies.forEach((enemy) => {
        const dx = Math.abs(enemy.x - playerPos.x);
        const dy = Math.abs(enemy.y - playerPos.y);
        if (dx < TILE_SIZE - 4 && dy < TILE_SIZE - 4) {
          setHealth((h) => {
            const newHealth = h - 1;
            if (newHealth <= 0) {
              setGameOver(true);
              if (user) {
                updateUserStats({ gamesPlayed: (user.gamesPlayed || 0) + 1 });
              }
            }
            return newHealth;
          });
          // Push player back
          setPlayerPos((prev) => ({
            x: Math.max(TILE_SIZE, Math.min((MAP_WIDTH - 2) * TILE_SIZE, prev.x + (prev.x > enemy.x ? 20 : -20))),
            y: Math.max(TILE_SIZE, Math.min((MAP_HEIGHT - 2) * TILE_SIZE, prev.y + (prev.y > enemy.y ? 20 : -20))),
          }));
        }
      });
    }, 1000 / 60);

    return () => clearInterval(gameLoop);
  }, [gameStarted, gameOver, enemies, playerPos, checkCollision, user, updateUserStats]);

  // Render game
  useEffect(() => {
    if (!canvasRef.current || !gameStarted) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);

    // Draw map
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const tile = map[y]?.[x];
        if (tile !== undefined) {
          ctx.fillStyle = TILE_COLORS[tile] || '#3d8b40';
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          
          // Add texture
          if (tile === TILES.GRASS) {
            ctx.fillStyle = '#4a9c4d';
            for (let i = 0; i < 3; i++) {
              ctx.fillRect(
                x * TILE_SIZE + Math.random() * 12,
                y * TILE_SIZE + Math.random() * 12,
                2,
                4
              );
            }
          }
        }
      }
    }

    // Draw collectibles
    collectibles.forEach((c) => {
      if (c.type === 'heart') {
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath();
        ctx.arc(c.x + 8, c.y + 8, 6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath();
        ctx.moveTo(c.x + 8, c.y + 2);
        ctx.lineTo(c.x + 14, c.y + 8);
        ctx.lineTo(c.x + 8, c.y + 14);
        ctx.lineTo(c.x + 2, c.y + 8);
        ctx.closePath();
        ctx.fill();
      }
    });

    // Draw enemies
    ctx.fillStyle = '#9b59b6';
    enemies.forEach((enemy) => {
      ctx.fillRect(enemy.x + 2, enemy.y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      // Eyes
      ctx.fillStyle = '#fff';
      ctx.fillRect(enemy.x + 4, enemy.y + 5, 3, 3);
      ctx.fillRect(enemy.x + 9, enemy.y + 5, 3, 3);
      ctx.fillStyle = '#9b59b6';
    });

    // Draw player
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(playerPos.x + 2, playerPos.y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    
    // Player face direction indicator
    ctx.fillStyle = '#2ecc71';
    switch (playerDirection) {
      case 0: ctx.fillRect(playerPos.x + 6, playerPos.y + 12, 4, 2); break;
      case 1: ctx.fillRect(playerPos.x + 2, playerPos.y + 6, 2, 4); break;
      case 2: ctx.fillRect(playerPos.x + 12, playerPos.y + 6, 2, 4); break;
      case 3: ctx.fillRect(playerPos.x + 6, playerPos.y + 2, 4, 2); break;
    }

  }, [gameStarted, map, playerPos, playerDirection, enemies, collectibles]);

  // Mobile controls
  const handleMobileControl = (direction: string) => {
    keysRef.current.clear();
    keysRef.current.add(direction);
    setKeys(new Set(keysRef.current));
  };

  const handleMobileControlEnd = () => {
    keysRef.current.clear();
    setKeys(new Set());
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-500/10 via-emerald-500/10 to-teal-500/10 border border-green-500/20 p-4 sm:p-6">
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-green-500/20 rounded-full blur-3xl" />
        
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">The Game</h1>
              <p className="text-xs text-gray-400">NES-style adventure</p>
            </div>
          </div>
          
          {gameStarted && (
            <div className="flex items-center gap-4">
              {/* Health */}
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <svg
                    key={i}
                    className={`w-5 h-5 ${i < health ? 'text-red-500' : 'text-gray-600'}`}
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                  </svg>
                ))}
              </div>
              {/* Score */}
              <div className="px-3 py-1 rounded-lg bg-yellow-500/20 border border-yellow-500/30">
                <span className="text-yellow-400 font-bold">{score}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Game Area */}
      <div className="rounded-2xl bg-gray-800/50 border border-gray-700/50 overflow-hidden">
        <div className="p-4 flex justify-center">
          {!gameStarted ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Ready to Play?</h2>
              <p className="text-gray-400 text-sm mb-6">Use arrow keys or WASD to move. Collect hearts and rupees!</p>
              <button
                onClick={initGame}
                className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white font-semibold rounded-xl transition-all duration-200"
              >
                Start Game
              </button>
            </div>
          ) : gameOver ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Game Over!</h2>
              <p className="text-gray-400 text-sm mb-2">Final Score: <span className="text-yellow-400 font-bold">{score}</span></p>
              <button
                onClick={initGame}
                className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white font-semibold rounded-xl transition-all duration-200 mt-4"
              >
                Play Again
              </button>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              width={MAP_WIDTH * TILE_SIZE}
              height={MAP_HEIGHT * TILE_SIZE}
              className="border-4 border-gray-700 rounded-lg"
              style={{ imageRendering: 'pixelated' }}
            />
          )}
        </div>

        {/* Mobile Controls */}
        {gameStarted && !gameOver && (
          <div className="p-4 border-t border-gray-700/50 sm:hidden">
            <div className="flex flex-col items-center gap-2">
              <button
                onTouchStart={() => handleMobileControl('arrowup')}
                onTouchEnd={handleMobileControlEnd}
                className="w-14 h-14 bg-gray-700/50 rounded-xl flex items-center justify-center active:bg-gray-600/50"
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <div className="flex gap-2">
                <button
                  onTouchStart={() => handleMobileControl('arrowleft')}
                  onTouchEnd={handleMobileControlEnd}
                  className="w-14 h-14 bg-gray-700/50 rounded-xl flex items-center justify-center active:bg-gray-600/50"
                >
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onTouchStart={() => handleMobileControl('arrowdown')}
                  onTouchEnd={handleMobileControlEnd}
                  className="w-14 h-14 bg-gray-700/50 rounded-xl flex items-center justify-center active:bg-gray-600/50"
                >
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <button
                  onTouchStart={() => handleMobileControl('arrowright')}
                  onTouchEnd={handleMobileControlEnd}
                  className="w-14 h-14 bg-gray-700/50 rounded-xl flex items-center justify-center active:bg-gray-600/50"
                >
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="rounded-xl bg-gray-800/30 border border-gray-700/30 p-4">
        <h3 className="text-sm font-semibold text-white mb-2">How to Play</h3>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>• Use Arrow Keys or WASD to move</li>
          <li>• Collect yellow rupees for points</li>
          <li>• Collect red hearts to restore health</li>
          <li>• Avoid purple enemies!</li>
        </ul>
      </div>
    </div>
  );
};

export default ZeldaGame;
