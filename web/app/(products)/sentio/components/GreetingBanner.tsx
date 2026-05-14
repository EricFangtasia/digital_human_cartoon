"use client";

interface GreetingBannerProps {
  message: string;
}

export function GreetingBanner({ message }: GreetingBannerProps) {
  return (
    <div className="mx-6 mb-2 px-4 py-2 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 text-sm text-white/90 text-center">
      {message}
    </div>
  );
}
