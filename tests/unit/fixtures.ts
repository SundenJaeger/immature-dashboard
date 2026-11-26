// Invented test data shaped like GET /api/samples. No real records.
import type {Replicate, ReviewStatus, SampleRecord} from "../../src/types";

export interface PhotoInput {
    no: number;
    weight: number;
    quality?: "good" | "bad";
    status?: ReviewStatus;
    technician?: string;
}

export function photo(sampleId: string, input: PhotoInput, extra: Partial<Replicate> = {}): Replicate {
    const [season, indexNumber, sampleTag] = sampleId.split("|");
    return {
        id: `id-${sampleId}-${input.no}`.replaceAll("|", "-"),
        technicianName: input.technician ?? "Test Technician",
        createdAt: "2026-11-24T01:00:42.000Z",
        sampleId: `${season}-${indexNumber}-${sampleTag}`,
        aiPredictedGrains: [],
        confirmedGrains: [],
        immatureWeight: input.weight,
        percentage: Math.round((input.weight / 30) * 10000) / 100,
        grade: "G1",
        reviewStatus: input.status ?? "review",
        imagePublicId: "test/image",
        imageSecureUrl: "https://example.invalid/image.png",
        meetsRecommendedValue: false,
        season,
        indexNumber,
        selectionName: "Test Line",
        sampleNo: Number(sampleTag.slice(1)),
        replicateNo: input.no,
        replicateLabel: `${season}-${indexNumber}-${sampleTag}-${String(input.no).padStart(2, "0")}`,
        confidence: 0.9,
        quality: input.quality ?? "good",
        manuallyOverridden: true,
        capturedAt: "2026-11-24T01:00:00.000Z",
        submittedAt: "2026-11-24T01:00:42.000Z",
        processingSeconds: 42,
        ...extra,
    };
}

/** sample("2026WS", "T-001", 1, [...]) builds one SampleRecord. */
export function sample(season: string, indexNumber: string, sampleNo: number, photos: PhotoInput[]): SampleRecord {
    const key = `${season}|${indexNumber}|S${sampleNo}`;
    const replicates = photos.map((input) => photo(key, input));
    return {
        season,
        indexNumber,
        selectionName: "Test Line",
        sampleNo,
        sampleId: `${season}-${indexNumber}-S${sampleNo}`,
        replicateCount: replicates.length,
        goodCount: replicates.filter((record) => record.quality === "good").length,
        status: "review",
        averageWeight: null,
        averagePercentage: null,
        averageGrade: null,
        meetsRecommendedValue: null,
        latestSubmittedAt: null,
        replicates,
    };
}
