-- 健康每日指标新增步数与环境音量列
-- Reason: 快捷指令可上报睡眠/深睡/REM/步数/环境音量;步数与环境音量提升为独立列,便于按天趋势查询。
ALTER TABLE `health_daily_metrics` ADD COLUMN `steps` integer;
ALTER TABLE `health_daily_metrics` ADD COLUMN `env_audio_db` real;
