'use client';
import { useEffect, useRef, useState } from 'react';
import { remainingTime } from '@/lib/vivix/session-policy';
export function LiveCountdown({ deadline, onExpire }: { deadline: number; onExpire: () => void }) {
  const [now, setNow] = useState(Date.now);
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    let fired = false;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline && !fired) {
        fired = true;
        expire.current();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return (
    <span
      className={'countdown' + (deadline - now <= 60_000 ? ' countdown-warning' : '')}
      aria-label="Session time remaining"
    >
      {remainingTime(deadline, now)}
    </span>
  );
}
