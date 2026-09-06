import { createFileRoute } from "@tanstack/react-router";
import { BioflogApp } from "@/components/bioflog/app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <BioflogApp />;
}
