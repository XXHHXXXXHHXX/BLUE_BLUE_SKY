import CloneCanvas from "../../src/components/topology/CloneCanvas";

export const metadata = {
  title: "蓝天系统 - 拓扑分身",
  description: "蓝天系统 - 拓扑监控分身页面",
};

interface ViewPageProps {
  searchParams: Promise<{ topology?: string }>;
}

export default async function ViewPage({ searchParams }: ViewPageProps) {
  const params = await searchParams;
  const initialTopologyId = params.topology;
  return <CloneCanvas initialTopologyId={initialTopologyId} />;
}
