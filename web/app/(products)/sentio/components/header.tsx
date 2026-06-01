import { LogoBar } from "@/components/header/logo";
import { Items } from "../items";
import { Switch, addToast, Tooltip } from "@heroui/react";
import { UserMinusIcon, UserPlusIcon } from "@heroicons/react/24/solid";
import { useSentioChatModeStore, useChatRecordStore, useSentioAsrStore } from "@/lib/store/sentio";
import { CHAT_MODE } from "@/lib/protocol";
import { useTranslations } from 'next-intl';

function ChatModeSwitch() {
    const t = useTranslations('Products.sentio');
    const { chatMode, setChatMode } = useSentioChatModeStore();
    const { enable } = useSentioAsrStore();
    const { clearChatRecord } = useChatRecordStore();
    const onSelect = (isSelected: boolean) => {
        if (enable) {
            setChatMode(isSelected ? CHAT_MODE.IMMSERSIVE : CHAT_MODE.DIALOGUE)
            clearChatRecord();   
        } else {
            addToast({
                title: t('asrEnableTip'),
                color: "warning"
            })
        }
    }
    return (
        <Tooltip className="opacity-90" placement="bottom" content={chatMode == CHAT_MODE.IMMSERSIVE ? "切换到普通对话" : "切换到沉浸语音"}>
            <Switch
                color="secondary"
                startContent={<UserPlusIcon/>}
                endContent={<UserMinusIcon/>}
                isSelected={chatMode == CHAT_MODE.IMMSERSIVE}
                onValueChange={onSelect}
                aria-label="聊天模式"
            />
        </Tooltip>
    )
}

export function Header() {
    return (
        <div className="flex w-full h-[64px] p-6 justify-between z-10">
            <LogoBar />
            <div className="flex flex-row gap-4 items-center">
                <ChatModeSwitch />
                <Items />
            </div>
        </div>
    )
}
