import { LogoIcon } from "@/components/icons/logo";
import { hongLei } from '@/lib/font';
import clsx from "clsx";


export function LogoBar() {
    return (
        <div className="flex items-center">
            <div className="flex items-center gap-1 justify-center font-bold text-inherit" aria-label="心语陪伴">
                <LogoIcon className="size-8 text-red-600" />
                <p className={clsx(hongLei.className,"invisible md:visible text-2xl")}>心语陪伴</p>
            </div>
        </div>
    )
}
