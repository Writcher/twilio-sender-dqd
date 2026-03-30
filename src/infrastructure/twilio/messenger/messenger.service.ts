import { Injectable, Logger } from "@nestjs/common";
import { TwilioService } from "../twilio.service";
import { ConfigService } from "@nestjs/config";
import { NominaService } from "src/modules/nomina/nomina.service";
import { EmployeeRecords, RegistrosAccesoService } from "src/modules/registrosacceso/registroacceso.service";
import { Cron } from "@nestjs/schedule";
import { LoggerService } from "src/infrastructure/logger/logger.service";

@Injectable()
export class MessengerService {
    private readonly logger = new Logger(MessengerService.name);

    constructor(
        private configService: ConfigService,
        private twilioService: TwilioService,
        private nominaService: NominaService,
        private registrosAccesoService: RegistrosAccesoService,
        private fileLogger: LoggerService
    ) { }

    async sendReportsToAll() {
        this.logger.log('═══════════════════════════════════════════════════');
        //Init counters
        let successCount = 0;
        let failureCount = 0;
        let skippedCount = 0;
        const failures: Array<{ dni: string; reason: string; error?: string }> = [];
        //Get all active uocra employees with phone numbers
        const employees = await this.nominaService.getUocraEmployeesInfo();
        this.logger.log(`Found ${employees.length} employees`);
        this.fileLogger.logReportStart(employees.length);
        //Go through each employee
        for (const employee of employees) {
            const failures: Array<{ dni: string; reason: string; error?: string }> = [];
            //Get employee access records
            const records = await this.registrosAccesoService.getEmployeeRecords(employee.dni);
            //Construct message
            if (records.length === 0) {
                skippedCount++
                this.logger.warn(`Skipped DNI ${employee.dni}`);
                this.fileLogger.logSkipped(employee.dni, 'No records found');
                failures.push({
                    dni: employee.dni,
                    reason: 'No records found'
                });
                continue;
            };
            const reportVariables = this.buildReportVariables(records);
            //Format phone number
            const cleanedPhone = employee.telefono.replace(/\s/g, "");
            const formatedPhone = `+549${cleanedPhone}`;
            //Send message
            const template = this.configService.get<string>('TWILIO_HOUR_TEMPLATE_ID');
            const variables = {
                "1": employee.apellido + ' ' + employee.nombre + ' - DNI: ' + employee.dni,
                "2": reportVariables["1"],
                "3": reportVariables["2"],
                "4": reportVariables["3"]
            };
            try {
                const result = await this.twilioService.sendMessage(formatedPhone, template!, variables);
                if (result.success) {
                    successCount++;
                    this.logger.debug(`Sent DNI ${employee.dni} (${formatedPhone})`);
                    this.fileLogger.logSuccess(employee.dni, formatedPhone);
                } else {
                    failureCount++;
                    this.logger.error(`Failed DNI ${employee.dni} (${formatedPhone}): ${result.error}`);
                    this.fileLogger.logFailure(employee.dni, formatedPhone, 'Twilio API error', result.error);
                    failures.push({
                        dni: employee.dni,
                        reason: 'Twilio API error',
                        error: result.error
                    });
                }
            } catch (error) {
                failureCount++;
                this.logger.error(`Exception DNI ${employee.dni}: ${error.message}`);
                this.fileLogger.logFailure(employee.dni, formatedPhone, 'Processing exception', error.message);
                failures.push({
                    dni: employee.dni,
                    reason: 'Processing exception',
                    error: error.message
                });
            };
        };
        this.logger.log('═══════════════════════════════════════════════════');
        this.logger.log(`Total Employees: ${employees.length}`);
        this.logger.log(`Successful: ${successCount}`);
        this.logger.log(`Failed: ${failureCount}`);
        this.logger.log(`Skipped (no records): ${skippedCount}`);
        this.logger.log('═══════════════════════════════════════════════════');
        const summary = {
            total: employees.length,
            successful: successCount,
            failed: failureCount,
            skipped: skippedCount
        };
        this.fileLogger.logSummary(summary);
        if (failures.length > 0) {
            this.logger.error('FAILURE DETAILS:');
            failures.forEach(f => {
                this.logger.error(`  DNI ${f.dni}: ${f.reason}${f.error ? ` - ${f.error}` : ''}`);
            });
            this.logger.error('═══════════════════════════════════════════════════');
        }
    };

    async sendTargetedReport(dni: string) {
        try {
            //Get employee data from dni
            const employee = await this.nominaService.getEmployeeInfo(dni);
            //get employee access records
            const records = await this.registrosAccesoService.getEmployeeRecords(dni);
            //Construct message
            if (records.length === 0) {
                return { success: false, message: 'No records found' };
            };
            const reportVariables = this.buildReportVariables(records);
            //Format phone number
            const cleanedPhone = employee.telefono.replace(/\s/g, "");
            const formatedPhone = `+549${cleanedPhone}`;
            //Send message
            const template = this.configService.get<string>('TWILIO_HOUR_TEMPLATE_ID');
            const variables = {
                "1": employee.apellido + ' ' + employee.nombre + ' - DNI: ' + dni,
                "2": reportVariables["1"],
                "3": reportVariables["2"],
                "4": reportVariables["3"]
            };

            await this.twilioService.sendMessage(formatedPhone, template!, variables);
            return { success: true, message: 'Message sent' };
        } catch (error) {
            console.error(`Failed to send message to DNI: ${dni}:`, error);
            return { success: false, message: error.message };
        };
    };

    private formatTime(timeString: string): string {
        if (!timeString) return 'N/A';
        return timeString.substring(0, 5);
    };

    private formatDate(fecha: string): string {
        const [year, month, day] = fecha.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const dias = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
        const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return `${dias[date.getDay()]} ${day} ${meses[month - 1]}`;
    };

    private formatDateShort(fecha: string): string {
        const [, month, day] = fecha.split('-');
        return `${month}/${day}`;
    };

    private buildReportVariables(records: EmployeeRecords[]): { "1": string, "2": string, "3": string } {
        const dayLines = this.groupByDate(records);
        const linesPerVariable = Math.ceil(dayLines.length / 3);

        const chunks = [
            dayLines.slice(0, linesPerVariable),
            dayLines.slice(linesPerVariable, linesPerVariable * 2),
            dayLines.slice(linesPerVariable * 2)
        ];

        const formatChunk = (chunk: string[]): string => {
            if (chunk.length === 0) return '-';
            return chunk.join(' • ');
        };

        return {
            "1": formatChunk(chunks[0]),
            "2": formatChunk(chunks[1]),
            "3": formatChunk(chunks[2])
        };
    }

    private groupByDate(records: EmployeeRecords[]): string[] {
        const grouped = new Map<string, EmployeeRecords[]>();
        for (const record of records) {
            const key = record.fecha_acceso;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(record);
        }

        const hasSplitShift = Array.from(grouped.values()).some(turnos => turnos.length > 1);

        return Array.from(grouped.entries()).map(([fecha, turnos]) => {
            turnos.sort((a, b) => a.turno - b.turno);
            if (hasSplitShift) {
                const dateStr = this.formatDateShort(fecha);
                const parts = turnos.map(t => `E: ${this.formatTime(t.hora_entrada)} / S: ${this.formatTime(t.hora_salida)}`);
                return `[${dateStr}] ${parts.join(' | ')}`;
            } else {
                const dateStr = this.formatDate(fecha);
                const parts = turnos.map(t => `Entrada: ${this.formatTime(t.hora_entrada)} / Salida: ${this.formatTime(t.hora_salida)}`);
                return `[${dateStr}] ${parts.join(' | ')}`;
            }
        });
    }

    @Cron('0 9 * * 1', {
        timeZone: 'America/Argentina/Buenos_Aires'
    })
    async scheduledWeeklyReport() {
        console.log('Running scheduled report...');
        try {
            await this.sendReportsToAll();
            console.log('Reports sent');
        } catch (error) {
            console.error('Scheduled report failed: ', error);
        };
    };
};