import { useQuery } from "@tanstack/react-query";
import { api, qk } from "./api";

export function useDemoMode(): boolean {
  const { data } = useQuery({ queryKey: qk.runtime, queryFn: api.runtime });
  return data?.readOnly !== false;
}
