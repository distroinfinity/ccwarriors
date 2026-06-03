/** Shimmer skeletons shown while the first WebSocket snapshot loads. */

export function Sk({
  w,
  h,
  circle = false,
  style = {},
}: {
  w: number | string;
  h: number;
  circle?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={"sk" + (circle ? " circle" : "")}
      style={{ width: w, height: h, ...style }}
    />
  );
}

/** Five placeholder leaderboard rows matching the real row grid. */
export function BoardSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <div className="row" key={i}>
          <Sk w={16} h={14} />
          <Sk w={30} h={30} circle />
          <div className="who">
            <Sk w={i % 2 ? 96 : 120} h={13} style={{ marginBottom: 6 }} />
            <Sk w={i % 2 ? 70 : 84} h={10} />
          </div>
          <Sk w={64} h={11} />
          <Sk w={72} h={13} />
          <div className="amt">
            <Sk w={64} h={15} />
          </div>
        </div>
      ))}
    </>
  );
}

/** Sidebar placeholder while we don't yet know whether the visitor has a card. */
export function CardSkeleton() {
  return (
    <aside className="side">
      <div className="seclabel">Your card</div>
      <div className="card-skel">
        <div className="card-skel-head">
          <Sk w={86} h={12} />
          <Sk w={52} h={10} />
        </div>
        <Sk w="100%" h={176} style={{ borderRadius: 0, display: "block" }} />
        <div className="card-skel-body">
          <Sk w={110} h={15} style={{ marginBottom: 7 }} />
          <Sk w={80} h={11} style={{ marginBottom: 16 }} />
          <Sk w={140} h={26} style={{ marginBottom: 8 }} />
          <Sk w={96} h={11} />
        </div>
      </div>
    </aside>
  );
}
