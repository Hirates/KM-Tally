import { EventEmitter } from "events";
import { BehaviorSubject } from "rxjs";
import { logger } from "..";
import { Address } from "../_models/Address";
import { Source } from "../_models/Source";
import { AddressTallyData } from "../_models/TallyData";

const RECONNECT_INTERVAL = 5000; // in ms
const MAX_FAILED_RECONNECTS = 5;

export class TallyInput extends EventEmitter {
    public connected = new BehaviorSubject<boolean>(false);
    public tally = new BehaviorSubject<AddressTallyData>({});
    private tallyData = {};
    public addresses = new BehaviorSubject<Address[]>([]);
    protected source: Source;
    private tryReconnecting = false;
    private reconnectFailureCounter = 0;
    reconnectTimeout: NodeJS.Timeout;

    constructor(source: Source) {
        super();
        this.source = source;
        logger(`Source: ${this.source.name} Creating connection.`, 'info-quiet');
        this.connected.subscribe((connected) => {
            if (connected) {
                // Connected, no more reconnects for now
                logger(`Source: ${this.source.name} Connected.`, 'info-quiet');
                this.tryReconnecting = true;
                this.reconnectFailureCounter = 0;
            } else {
                if (!this.tryReconnecting) {
                    // Connection attempt at startup
                    logger(`Source: ${this.source.name} Connect triggered at startup.`, 'info-quiet');
                    
                    if (this.source.unlimited_reconnects) {
                        logger(`Source: ${this.source.name} Inifinite reconnect attempts.`, 'info-quiet');
                    } else {
                        logger(`Source: ${this.source.name} Max default reconnect attempts ${MAX_FAILED_RECONNECTS}.`, 'info-quiet');
                    }
                    this.tryReconnecting = true;
                    return;
                }

                // Reconnect if number of reconnects less than max number of reconnects or
                // if infinite reconnects are configured
                if ((this.tryReconnecting && this.reconnectFailureCounter < MAX_FAILED_RECONNECTS) ||
                    (this.tryReconnecting && this.source.unlimited_reconnects)) {
                    if (this.reconnectTimeout) {
                        logger(`Source: ${this.source.name} Reconnect timeout not set.`, 'info-quiet');
                        return;
                    }

                    this.reconnectFailureCounter++;
                    logger(`Source: ${this.source.name} Reconnect attempt: ${this.reconnectFailureCounter}.`, 'info-quiet');

                    // Use configured timeout only if larger then tally arbiter default
                    if (this.source.reconnect_intervall > RECONNECT_INTERVAL) {
                        logger(`Source: ${this.source.name} Specific reconnect timeout: ${this.source.reconnect_intervall}.`, 'info-quiet');
                        this.reconnectTimeout = setTimeout(() => {
                            this.reconnectTimeout = undefined;
                            this.reconnect();
                        }, this.source.reconnect_intervall);
                    } else {
                        logger(`Source: ${this.source.name} Default reconnect timeout ${RECONNECT_INTERVAL}.`, 'info-quiet');
                        this.reconnectTimeout = setTimeout(() => {
                            logger(`Source: ${this.source.name} Default timeout.`, 'info-quiet');
                            this.reconnectTimeout = undefined;
                            this.reconnect();
                        }, RECONNECT_INTERVAL);

                    }
                } else {
                    logger(`Source: ${this.source.name} No more reconnects.`, 'info-quiet');
                }
            }
        });
    }

    public exit(): void {
        this.tryReconnecting = false;
    }
    public reconnect(): void { }
    
    protected addAddress(label: string, address: string) {
        this.addresses.next(this.addresses.value.concat({ label, address }));
    }
    
    protected removeAddress(address: string) {
        this.addresses.next(this.addresses.value.filter((a) => a.address !== address));
    }
    
    protected renameAddress(address: string, newAddress: string, newLabel: string) {
        this.emit("renameAddress", address, newAddress);
        this.addresses.next(this.addresses.value.filter((a) => a.address !== address).concat({ address: newAddress, label: newLabel }));
    }

    protected addBusToAddress(address: string, bus: string) {
        if (!Array.isArray(this.tallyData[address])) {
            this.tallyData[address] = [];
        }
        if (!this.tallyData[address].includes(bus)) {
            this.tallyData[address].push(bus);
        }
    }

    protected removeBusFromAddress(address: string, bus: string) {
        if (!Array.isArray(this.tallyData[address])) {
            this.tallyData[address] = [];
        } else  {
            this.tallyData[address] = this.tallyData[address].filter((b) => b !== bus);
        }
    }

    protected removeBusFromAllAddresses(bus: string) {
        for (const address of Object.keys(this.tallyData)) {
            this.tallyData[address] = this.tallyData[address].filter((b) => b !== bus);
        }
    }

    protected setBussesForAddress(address: string, busses: string[]) {
        this.tallyData[address] = busses || [];
    }

    protected clearTallies() {
        for(let i = 0; i < this.addresses.value.length; i++) {
            let currentAddress = this.addresses.value[i].address;
            this.setBussesForAddress(currentAddress, []);
            this.sendTallyData();
        }
    }

    protected sendTallyData() {
        this.tally.next(this.tallyData);
    }
}