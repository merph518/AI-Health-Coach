package com.fagerteam.coach

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.LocalDate
import java.time.Period

/** Reads daily totals from Health Connect. Read only: steps, active calories and exercise sessions. */
class HealthReader(private val context: Context) {
    companion object {
        const val PROVIDER = "com.google.android.apps.healthdata"
        const val MAX_DAYS = 14
        val PERMISSIONS = setOf(
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        )
    }

    data class Day(val date: LocalDate, val steps: Long?, val activeKcal: Double?, val exerciseMin: Long?)

    private val client by lazy { HealthConnectClient.getOrCreate(context) }

    fun sdkStatus(): Int = HealthConnectClient.getSdkStatus(context, PROVIDER)

    suspend fun granted(): Set<String> = client.permissionController.getGrantedPermissions()

    /**
     * Totals per local day for the requested dates (the last 30 days at most, 14 dates at most).
     * The aggregate API de-duplicates overlapping sources (phone, Samsung Health, a watch), so a walk
     * recorded by both the phone and the watch is only counted once.
     */
    suspend fun read(dates: Collection<LocalDate>): List<Day> {
        val today = LocalDate.now()
        val wanted = dates.filter { !it.isAfter(today) && !it.isBefore(today.minusDays(29)) }
            .distinct().sorted().takeLast(MAX_DAYS)
        if (wanted.isEmpty()) return emptyList()
        val groups = client.aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(
                metrics = setOf(
                    StepsRecord.COUNT_TOTAL,
                    ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL,
                    ExerciseSessionRecord.EXERCISE_DURATION_TOTAL,
                ),
                timeRangeFilter = TimeRangeFilter.between(
                    wanted.first().atStartOfDay(),
                    wanted.last().plusDays(1).atStartOfDay(),
                ),
                timeRangeSlicer = Period.ofDays(1),
            )
        )
        val byDate = groups.associateBy { it.startTime.toLocalDate() }
        return wanted.map { date ->
            val r = byDate[date]?.result
            Day(
                date = date,
                steps = r?.get(StepsRecord.COUNT_TOTAL),
                activeKcal = r?.get(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)?.inKilocalories,
                exerciseMin = r?.get(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL)?.toMinutes(),
            )
        }
    }
}
