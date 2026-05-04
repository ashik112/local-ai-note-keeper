import { motion } from "framer-motion";

type VoiceVisualizerProps = { active: boolean };

export function VoiceVisualizer({ active }: VoiceVisualizerProps) {
  return (
    <div className="flex h-8 items-end justify-center gap-[2px] px-4 sm:h-10">
      {Array.from({ length: 14 }).map((_, i) => (
        <motion.div
          key={i}
          className="w-[2px] rounded-full bg-gradient-to-t from-primary to-accent sm:w-[3px]"
          animate={
            active
              ? {
                  height: [4, 14 + ((i * 9) % 22), 8],
                  opacity: [0.35, 1, 0.5]
                }
              : { height: 4, opacity: 0.14 }
          }
          transition={{
            duration: 0.38 + (i % 6) * 0.04,
            repeat: active ? Infinity : 0,
            repeatType: "reverse",
            ease: "easeInOut"
          }}
        />
      ))}
    </div>
  );
}
