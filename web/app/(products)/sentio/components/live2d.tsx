'use client'

import React, { useEffect, useState } from 'react';
import { LAppDelegate } from '@/lib/live2d/src/lappdelegate';
import * as LAppDefine from '@/lib/live2d/src/lappdefine';
import { Spinner } from '@heroui/react';
import { useSentioBackgroundStore, useSentioCharacterStore } from "@/lib/store/sentio";
import { useLive2D } from '../hooks/live2d';
import { RESOURCE_TYPE, ResourceModel } from '@/lib/protocol';
import * as CONSTANTS from '@/lib/constants';
import { getSrcPath } from '@/lib/path';

export function Live2d() {
    const { ready, setLive2dCharacter } = useLive2D();
    const { background } = useSentioBackgroundStore();
    const [isScratching, setIsScratching] = useState(false);

    const handleLoad = () => {
        if (LAppDelegate.getInstance().initialize() == false) {
            return;
        }
        LAppDelegate.getInstance().run();
        // Live2D 初始化完成后，立即加载 character
        // 修复原因：setAppConfig/setCurrentCharacter 可能在此组件挂载之前调用，
        // 彼时 _subdelegates 为空，changeCharacter 被忽略，导致模型文件永远不会加载
        let characterToLoad: ResourceModel | null = useSentioCharacterStore.getState().character;
        if (characterToLoad == null) {
            // 未配置 character 时，使用默认 Kei 模型
            characterToLoad = {
                resource_id: "FREE_Kei",
                name: CONSTANTS.SENTIO_CHARACTER_DEFAULT,
                link: getSrcPath(CONSTANTS.SENTIO_CHARACTER_DEFAULT_PORTRAIT),
                type: RESOURCE_TYPE.CHARACTER,
            };
        }
        setLive2dCharacter(characterToLoad);
    }

    const handleResize = () => {
        if (LAppDefine.CanvasSize === 'auto') {
            LAppDelegate.getInstance().onResize();
        }
    }

    const handleBeforeUnload = () => {
        // 释放实例
        LAppDelegate.releaseInstance();
    }

    const handleCanvasClick = () => {
        // 触发抓痒痒动画
        setIsScratching(true);
        setTimeout(() => setIsScratching(false), 300); // 300ms后恢复
    }

    useEffect(() => {
        handleLoad();
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            handleBeforeUnload();
        }
    }, []);

    return (
        <div className='absolute top-0 left-0 w-full h-full z-0'>
            <style jsx>{`
                @keyframes scratch {
                    0%, 100% { transform: translate(0, 0) rotate(0deg); }
                    25% { transform: translate(-3px, -3px) rotate(-5deg); }
                    50% { transform: translate(3px, 3px) rotate(5deg); }
                    75% { transform: translate(-2px, 2px) rotate(-3deg); }
                }
                
                .scratching-cursor {
                    animation: scratch 0.3s ease-in-out;
                }
            `}</style>
            {
                background && (background.link.endsWith('.mp4') ? 
                <video 
                    className='absolute top-0 left-0 w-full h-full object-cover z-[-1]' 
                    autoPlay 
                    muted 
                    loop
                    src={background.link}
                    style={{ pointerEvents: 'none' }}
                />
                :
                <img 
                    src={background.link}
                    alt="Background Image"
                    className='absolute top-0 left-0 w-full h-full object-cover z-[-1]'
                />
                )
            }
            {
                !ready && <div className='absolute top-0 left-0 w-full h-full flex flex-row gap-1 items-center justify-center z-50'>
                    <p className='text-xl font-bold'>加载中...</p>
                    <Spinner color='warning' variant="dots" size='lg'/>
                </div>
            }
            <canvas
                id="live2dCanvas"
                onClick={handleCanvasClick}
                onMouseDown={() => console.log('[Live2D Canvas] Mouse down')}
                onMouseUp={() => console.log('[Live2D Canvas] Mouse up')}
                className={`w-full h-full bg-transparent bg-center bg-cover ${isScratching ? 'scratching-cursor' : ''}`}
                style={{ 
                    cursor: isScratching ? 'grabbing' : 'grab',
                    userSelect: 'none',
                    pointerEvents: 'auto',
                    touchAction: 'none'
                }}
            />
        </div>   
    )
}
