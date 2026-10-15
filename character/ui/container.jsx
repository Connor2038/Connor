export default function Container({ Avatar }) {
  return (
    <main
      className="single-avatar-stage"
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        containerType: "size",
        overflow: "hidden",
      }}
    >
      <style>{`
        .single-avatar-stage[data-share-preview-arrangement="character-only-landscape"]
          > [data-character-avatar-frame] {
          width: min(100cqw, 177.777778cqh) !important;
          height: auto !important;
          aspect-ratio: 16 / 9 !important;
        }
      `}</style>
      <Avatar
        style={{
          width: "min(100cqw, 56.25cqh)",
          height: "auto",
          aspectRatio: "9 / 16",
        }}
      />
    </main>
  );
}
