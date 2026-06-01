'use client'

import { useRef, useEffect, memo, useCallback } from 'react';
import { UserIcon, SunIcon } from '@heroicons/react/24/solid';
import { useChatRecordStore, useSentioBasicStore } from '@/lib/store/sentio';
import { CHAT_ROLE, ChatMessage } from '@/lib/protocol';
import { Card, CardBody, Spinner } from '@heroui/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm'
import { useTranslations } from 'next-intl';
import clsx from 'clsx';

const ChatThink = memo(({message, thinking}: {message: string, thinking: boolean}) => {
    const t = useTranslations('Products.sentio');
    const { showThink } = useSentioBasicStore();
    const ThinkMessage = () => {
        return (
            <div className='flex flex-col gap-1'>
                <p className='text-2xl'>🤔</p>
                <Markdown
                    className='text-slate-700 text-sm border-l-2 px-2 border-slate-500'
                    remarkPlugins={[remarkGfm]}
                >
                    {message.replace(/\\n/g, "  \n")}
                </Markdown>
            </div>
        )
    }
    const Thinking = useCallback(() => {
        return (
            thinking ?
            <div className='flex flex-row gap-1 items-center overflow-hidden'>
                <p className='text-2xl'>🤔</p>
                <p>{t('thinking')}</p>
                <Spinner color='warning' variant="dots" />
            </div>
            :
            <></>
        )
    }, [thinking]);

    return (
        showThink? <ThinkMessage /> : <Thinking />
    )
});

export const ChatRecord = ({ className }: { className?: string }) => {
    const chatbotRef = useRef<HTMLDivElement>(null);
    const { chatRecord, clearChatRecord } = useChatRecordStore();
    useEffect(() => {
        // 聊天滚动条到底部
        chatbotRef.current.scrollTop = chatbotRef.current.scrollHeight + 100;
    }, [chatRecord]);

    useEffect(() => {
        // 新窗口清空聊天记录
        clearChatRecord();
    }, []);
    return (
        <div className={clsx('flex flex-col w-full space-y-4 p-3 overflow-y-auto no-scrollbar z-10 transition-opacity duration-200', className)} ref={chatbotRef}>
            {
                chatRecord.map((message: ChatMessage, index: number) => (
                    <div key={index}>
                        <div className={clsx(
                            "flex gap-2 items-start",
                            message.role == CHAT_ROLE.HUMAN ? "justify-end" : ""
                        )}>
                            <div className={clsx(
                                "min-w-8",
                                message.role == CHAT_ROLE.HUMAN ? "text-slate-700 order-2" : "text-yellow-500 order-1"
                            )}>
                                {message.role == CHAT_ROLE.HUMAN ? <UserIcon className='size-6' /> : <SunIcon className='size-6' />}
                            </div>
                            <Card className={clsx(
                                "max-w-md opacity-95 shadow-lg",
                                message.role == CHAT_ROLE.HUMAN ? "order-1" : "order-2"
                                )}
                            >
                                <CardBody className='flex flex-col gap-2'>
                                    {/* 思考内容展示 */
                                        message.role == CHAT_ROLE.AI &&
                                        message.think && <ChatThink message={message.think} thinking={message.content.length == 0 && index == chatRecord.length - 1}/>
                                    }
                                    {/* 回复内容展示 */}
                                    {/*这里将\n替换为 两个空格 + \n 是为了兼容Markdown的语法 */}
                                    <Markdown remarkPlugins={[remarkGfm]}>{message.content.replace(/\\n/g, "  \n")}</Markdown>
                                </CardBody>
                            </Card>
                        </div>
                    </div>
                ))
            }
        </div>
    )
}
