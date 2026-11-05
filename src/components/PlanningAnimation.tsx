/** A route drawing itself from start to finish, with a runner dot on its tip. */
export default function PlanningAnimation() {
  // one big detour between two points, like the routes LONGCUT makes
  const d = 'M20 52 C 40 10, 90 6, 120 22 S 190 70, 220 40 S 250 30, 260 52';
  return (
    <svg className="plan-anim" viewBox="0 0 280 64" aria-hidden="true">
      <path d="M20 52 L260 52" className="plan-direct" />
      <path d={d} pathLength={100} className="plan-route" />
      <circle r="5" className="plan-runner">
        <animateMotion dur="2.4s" repeatCount="indefinite" path={d} keyPoints="0;1;1" keyTimes="0;0.75;1" calcMode="linear" />
      </circle>
      <circle cx="20" cy="52" r="6" className="plan-start" />
      <circle cx="260" cy="52" r="6" className="plan-end" />
    </svg>
  );
}
