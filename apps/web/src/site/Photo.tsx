export function Photo(props: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <img
      src={props.src}
      alt={props.alt}
      className={props.className ?? "photo"}
      loading={props.priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
