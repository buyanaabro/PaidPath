import Button from "@/components/ui/Button";

/** Creates the visitor's own demo copy (works without JavaScript). */
export default function DemoButton({
  className = "",
  label = "Try the live demo",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <form action="/api/demo" method="post">
      <Button type="submit" className={className}>
        {label}
      </Button>
    </form>
  );
}
