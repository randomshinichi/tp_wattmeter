const BaseIndicator = imports.ui.status.power.Indicator;
const ExtensionUtils = imports.misc.extensionUtils;
const Panel = imports.ui.main.panel;
const Shell = imports.gi.Shell;
const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Config = imports.misc.config;


/** Settings
 */

const LAPMODE = "/sys/devices/platform/thinkpad_acpi/dytc_lapmode"
const HISTORY_DEPTH = 5;
const MEASURE_PERIOD = 1000;
const FORCE_SYNC_PERIOD = 5000;

const BAT0_ROOT = "/sys/class/power_supply/BAT0/";
const BAT1_ROOT = "/sys/class/power_supply/BAT1/";


/** Indicator
 */

var TPIndicator = GObject.registerClass(
    {
        GTypeName: 'TPIndicator',
    },
    class TPIndicator extends BaseIndicator {
        _init() {
            super._init();

            this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.tp_wattmeter');
            this.settings.connect('changed::period-sec', () => { this._spawn(); });  // restart timers on setting change

            this.readings = [];
            this.last_value = 0.0;
            this.tm_measure = null;
        }

        _getBatteryStatus() {
            const pct = this._proxy.Percentage.toFixed(0);
            const power = this.last_value.toFixed(1);
            const status0 = this._read_file(BAT0_ROOT + "status", '???')
            const status1 = this._read_file(BAT1_ROOT + "status", '???');
            // const signmap = {
            //     "Charging": "+",
            //     "Discharging": "-",
            //     "Unknown": " ",
            // }
            // return {
            //     "BAT0": signmap[status0],
            //     "BAT1": signmap[status1]
            // }
            if (status0 == "Discharging" || status1 == "Discharging") {
                return '-'
            } else if (status0 == "Charging" || status1 == "Charging") {
                return '+'
            } else {
                return ' '
            }

            let lap_mode_char = this._getLapMode()
            return _("%s%% %s%sW%s").format(pct, sign, power, lap_mode_char);
        }

        _getLapMode() {
            const show_lap_mode = this.settings.get_boolean('lap-mode');
            if (!show_lap_mode){
                return ('')
            }
            const status = this._read_file(LAPMODE, '???');
            let lap_mode_char = '';
            if (status == '1') {
                lap_mode_char = " lap";
            }
            else {
                lap_mode_char = ''
            }
            return (lap_mode_char)
        }

        _getBatteryCapacity() {
            return {
                "BAT0": this._read_file(BAT0_ROOT + "capacity", '???'),
                "BAT1": this._read_file(BAT1_ROOT + "capacity", '???')
            }
        }
        _buildOutput() {
            const capacities = this._getBatteryCapacity();
            const power = this.last_value.toFixed(1);
            let status = this._getBatteryStatus();

            return _("BAT0: %s%% BAT1: %s%% %s%sW").format(capacities["BAT0"], capacities["BAT1"],status, power);
        }

        _sync() {
            super._sync();
            this._percentageLabel.clutter_text.set_text(this._buildOutput());
            return true;
        }

        _read_file(filePath, defaultValue) {
            try {
                return Shell.get_file_contents_utf8_sync(filePath).trim();
            } catch (e) {
                log(`Cannot read file ${filePath}`, e);
            }
            return defaultValue;
        }
        _getPowerConsumption() {
            const power0 = parseFloat(this._read_file(BAT0_ROOT + "power_now", "0"), 0) / 1000000;
            const power1 = parseFloat(this._read_file(BAT1_ROOT + "power_now", "0"), 0) / 1000000;

            if (power0 == 0) {
                return power1
            } else {
                return power0
            }
        }
        _measure() {
            this.readings.push(this._getPowerConsumption())

            const avg_of = this.settings.get_int('avg-of');
            if (this.readings.length >= avg_of) {
                this.last_value = this.readings.reduce((acc, elem) => acc + elem, 0.0) / this.readings.length; // simple mean
                this._sync(); // update battery widget now!
                this.readings.length = 0;  // fastest way to clear array?
            } 
            return true;
        }

        _spawn() {
            if (this.tm_measure !== null) {
                GLib.source_remove(this.tm_measure);
            }
            this.tm_measure = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                this.settings.get_double('period-sec') * 1000,
                this._measure.bind(this),
            );
        }

        _stop() {
            GLib.source_remove(this.tm_measure);
            this.tm_measure = null;
        }
    }
);


/** Extension
 */

class TPWattMeter {
    constructor() {
        this.customIndicator = new TPIndicator();
        this.customIndicator._spawn();

        this.aggregateMenu = Panel.statusArea['aggregateMenu'];
        this.originalIndicator = this.aggregateMenu._power;
        this.aggregateMenu._indicators.replace_child(this.originalIndicator, this.customIndicator);
    }

    destroy(arg) {
        this.customIndicator._stop();
        this.aggregateMenu._indicators.replace_child(this.customIndicator, this.originalIndicator);
        this.customIndicator = null;
    }
}


/** Init
 */

let tp_wattmeter;


function enable() {
    tp_wattmeter = new TPWattMeter();
}

function disable() {
    tp_wattmeter.destroy();
    tp_wattmeter = null;
}
