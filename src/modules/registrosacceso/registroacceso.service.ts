import { Injectable } from '@nestjs/common';
import { SqlServerService } from 'src/infrastructure/database/sqlserver/sqlserver.service';

export interface EmployeeRecords {
    nombre: string;
    id_empleado: string;
    fecha_acceso: string;
    turno: number;
    hora_entrada: string;
    dispositivo_entrada: string;
    hora_salida: string;
    dispositivo_salida: string;
};

@Injectable()
export class RegistrosAccesoService {
    constructor(
        private sqlServerService: SqlServerService
    ) { };

    async getEmployeeRecords(dni: string): Promise<EmployeeRecords[]> {
        const result = await this.sqlServerService.query(
            `WITH AllMarks AS (
                SELECT
                    nombre,
                    id_empleado,
                    fecha_acceso,
                    hora_acceso,
                    nombre_dispositivo,
                    numero_serie_dispositivo
                FROM control_de_accesos.dbo.registros_acceso
                WHERE fecha_acceso >= DATEADD(DAY, -7, CAST(GETDATE() AS DATE))
                AND fecha_acceso < CAST(GETDATE() AS DATE)
                AND id_empleado = @dni
                AND numero_serie_dispositivo != 'L19848894'
            ),
            SplitShiftDays AS (
                SELECT DISTINCT id_empleado, fecha_acceso
                FROM AllMarks
                WHERE numero_serie_dispositivo IN (
                    'AZ9809981',
                    'FT3605486','FT3605499','FT3605496',
                    'FT3605489','FT3605498','FT3605490','FT3605502'
                )
            ),
            RegularRanked AS (
                SELECT
                    a.nombre, a.id_empleado, a.fecha_acceso, a.hora_acceso, a.nombre_dispositivo,
                    ROW_NUMBER() OVER (PARTITION BY a.id_empleado, a.fecha_acceso ORDER BY a.hora_acceso ASC) AS rn_asc,
                    ROW_NUMBER() OVER (PARTITION BY a.id_empleado, a.fecha_acceso ORDER BY a.hora_acceso DESC) AS rn_desc
                FROM AllMarks a
                LEFT JOIN SplitShiftDays s ON a.id_empleado = s.id_empleado AND a.fecha_acceso = s.fecha_acceso
                WHERE s.id_empleado IS NULL
            ),
            RegularResult AS (
                SELECT
                    nombre, id_empleado,
                    CONVERT(VARCHAR(10), fecha_acceso, 23) AS fecha_acceso,
                    1 AS turno,
                    CONVERT(VARCHAR(8), MAX(CASE WHEN rn_asc = 1 THEN hora_acceso END), 108) AS hora_entrada,
                    MAX(CASE WHEN rn_asc = 1 THEN nombre_dispositivo END) AS dispositivo_entrada,
                    CONVERT(VARCHAR(8), MAX(CASE WHEN rn_desc = 1 THEN hora_acceso END), 108) AS hora_salida,
                    MAX(CASE WHEN rn_desc = 1 THEN nombre_dispositivo END) AS dispositivo_salida
                FROM RegularRanked
                WHERE rn_asc = 1 OR rn_desc = 1
                GROUP BY nombre, id_empleado, fecha_acceso
            ),
            SplitOrdered AS (
                SELECT
                    a.nombre, a.id_empleado, a.fecha_acceso, a.hora_acceso, a.nombre_dispositivo,
                    LAG(a.hora_acceso) OVER (PARTITION BY a.id_empleado, a.fecha_acceso ORDER BY a.hora_acceso ASC) AS prev_hora
                FROM AllMarks a
                INNER JOIN SplitShiftDays s ON a.id_empleado = s.id_empleado AND a.fecha_acceso = s.fecha_acceso
            ),
            SplitFiltered AS (
                SELECT
                    nombre, id_empleado, fecha_acceso, hora_acceso, nombre_dispositivo,
                    ROW_NUMBER() OVER (PARTITION BY id_empleado, fecha_acceso ORDER BY hora_acceso ASC) AS mark_num
                FROM SplitOrdered
                WHERE prev_hora IS NULL OR DATEDIFF(MINUTE, prev_hora, hora_acceso) > 5
            ),
            SplitResult AS (
                SELECT
                    e.nombre, e.id_empleado,
                    CONVERT(VARCHAR(10), e.fecha_acceso, 23) AS fecha_acceso,
                    (e.mark_num + 1) / 2 AS turno,
                    CONVERT(VARCHAR(8), e.hora_acceso, 108) AS hora_entrada,
                    e.nombre_dispositivo AS dispositivo_entrada,
                    CONVERT(VARCHAR(8), s.hora_acceso, 108) AS hora_salida,
                    s.nombre_dispositivo AS dispositivo_salida
                FROM SplitFiltered e
                LEFT JOIN SplitFiltered s ON e.id_empleado = s.id_empleado AND e.fecha_acceso = s.fecha_acceso AND s.mark_num = e.mark_num + 1
                WHERE e.mark_num % 2 = 1
            )
            SELECT * FROM RegularResult
            UNION ALL
            SELECT * FROM SplitResult
            ORDER BY fecha_acceso ASC, turno ASC;`,
            { dni }
        );

        return result.recordset;
    };
};
    