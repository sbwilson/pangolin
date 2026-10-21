import { useQuery } from "@tanstack/react-query";
import { fetchReviewCounts } from "../../api.ts";
import { REVIEW_COUNT_KEY } from "./ReviewCardFrame.tsx";

/** The signed-in person's open count and the partner chip; undefined while loading or failed. */
export function useReviewCounts() {
  return useQuery({
    queryKey: REVIEW_COUNT_KEY,
    queryFn: fetchReviewCounts,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
}
