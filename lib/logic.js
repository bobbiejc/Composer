/**
 * add balance to a consumer's balance
 * @param {org.budblocks.addBalance} trade - the trade to be processed
 * @transaction
 */
async function addBalance(trade) {
    let participantRegistry = await getParticipantRegistry('org.budblocks.Consumer');
    let recipient = await participantRegistry.get(trade.recipient);
    recipient.balance += trade.amount;
    await participantRegistry.update(trade.recipient);
}

/**
 * remove balance from a consumer's balance
 * @param {org.budblocks.removeBalance} trade - the trade to be processed
 * @transaction
 */
async function removeBalance(trade) {
    let participantRegistry = await getParticipantRegistry('org.budblocks.Consumer');
    let recipient = await participantRegistry.get(trade.recipient);
    if (trade.amount > recipient.balance) {
        let factory = getFactory();
        let event = factory.newEvent('org.budblocks', 'BalanceTooLow');
        event.balance = recipient.balance;
        event.amount = trade.amount;
        emit(event);
        return;
    }
    recipient.balance -= trade.amount;
    await participantRegistry.update(recipient);
}

/**
 * create and send a note
 * @param {org.budblocks.sendNote} trade - the trade to be processed
 * @transaction
 */
async function sendNote(trade) {
    let participantRegistry = await getParticipantRegistry('org.budblocks.Consumer');
    let sender = await participantRegistry.get(trade.sender);
    let recipient = await participantRegistry.get(trade.recipient);
    //emit event if the sender account is frozen
    if (sender.earliest_note != null) {
        if (sender.earliest_note.expiration_date.getTime() < new Date().getTime()) {
            let factory = getFactory();
            let event = factory.newEvent('org.budblocks', 'AccountFrozen');
            event.field = sender.overdue_notes[0].field;
            event.recipient_name = sender.overdue_notes[0].recipient.name;
            event.amount = sender.overdue_notes[0].amount;
            event.expiration_date = sender.overdue_notes[0].expiration_date;
            event.date_sent = sender.overdue_notes[0].date_sent;
            emit(event);
            return;
        }
    }

    //get the factory and subID of the new note
    let this_note = sender.notes_sent++;
    let factory = getFactory();

    //create the new note
    let new_note = factory.newResource('org.budblocks', 'Note', sender.ID.concat('.').concat(this_note.toString()));
    new_note.sender = factory.newRelationship('org.budblocks', 'Consumer', sender.ID);
    new_note.recipient = factory.newRelationship('org.budblocks', 'Consumer', recipient.ID);
    new_note.field = trade.field;
    new_note.amount = trade.amount;
    new_note.expiration_date = trade.expiration_date;
    new_note.date_sent = trade.timestamp;

    // add the note to the asset registry
    let assetRegistry = await getAssetRegistry('org.budblocks.Note');
    await assetRegistry.add(new_note);
    
    //add the new note to the sender and receiver's notes and outgoing notes
    recipient.notes.push(factory.newRelationship('org.budblocks', 'Note', new_note.ID));
    sender.outgoing_notes.push(factory.newRelationship('org.budblocks', 'Note', new_note.ID));

    //check if the note is now the new earliest note
    if (sender.earliest_note == null) {
        sender.earliest_note = sender.outgoing_notes[sender.outgoing_notes.length-1];
    }
    else if (note.expiration_date.getTime() < sender.earliest_note.expiration_date.getTime()) {
        sender.earliest_note = sender.outgoing_notes[sender.outgoing_notes.length-1];
    }

    //update the Consumer participant registry
    await participantRegistry.update(sender);
    await participantRegistry.update(recipient);

    //emit events to sender and recipient
    let event = factory.newEvent('org.budblocks', 'NoteSent');
    event.field = new_note.field;
    event.recipient_name = recipient.name;
    event.amount = new_note.amount;
    event.expiration_date = new_note.expiration_date;
    event.date_sent = new_note.date_sent;
    emit(event);
    event = factory.newEvent('org.budblocks', 'NoteReceived');
    event.field = new_note.field;
    event.sender_name = sender.name;
    event.amount = new_note.amount;
    event.expiration_date = new_note.expiration_date;
    event.date_sent = new_note.date_sent;
    emit(event);
}

/**
 * resolve a note
 * @param {org.budblocks.resolveNote} trade - the trade to be processed
 * @transaction
 */
async function resolveNote(trade) {  // TODO add an update to the users dual credit score if the due date of the note has passed
    let assetRegistry = await getAssetRegistry('org.budblocks.Note');
    let note = await assetRegistry.get(trade.note);
    let participantRegistry = await getParticipantRegistry('org.budblocks.Consumer');
    let sender = note.sender;
    let recipient = note.recipient;

    // make sure you can actually resolve the note with your current balance
    if (sender.balance < note.amount) {
        let factory = getFactory();
        let event = factory.newEvent('org.budblocks', 'BalanceTooLow');
        event.balance = sender.balance;
        event.amount = note.amount;
        emit(event);
        return;
    }

    // update the sender and receiver balances, and remove the note from the registry
    sender.balance -= note.amount;
    recipient.balance += note.amount;
    sender.outgoing_notes.splice(sender.outgoing_notes.indexOf(note), 1);
    recipient.notes.splice(recipient.notes.indexOf(note), 1);
    await participantRegistry.update(sender);
    await participantRegistry.update(recipient);
    await assetRegistry.remove(note);

    // check if the note that sender just resolved was the one closest to expiration, and change if it was
    if (note == sender.earliest_note) {
        let new_earliest = sender.outgoing_notes[0];
        for (i = 0; i < sender.outgoing_notes.length; i++) {
            if (new_earliest.expiration_date.getTime() > sender.outgoing_notes[i].expiration_date.getTime()) {
                new_earliest = sender.outgoing_notes[i];
            }
        }
        sender.earliest_note = new_earliest;
        await participantRegistry.update(sender);
    }

    // create events for resolving the note, which goes to you, and paying the note which goes to the recipient
    let factory = getFactory();
    let event = factory.newEvent('org.budblocks', 'NoteResolved');
    event.field = note.field;
    event.recipient_name = recipient.name;
    event.amount = note.amount;
    event.expiration_date = note.expiration_date;
    event.date_sent = note.date_sent;
    emit(event);
    event = factory.newEvent('org.budblocks', 'NotePaid');
    event.field = note.field;
    event.sender_name = sender.name;
    event.amount = note.amount;
    event.expiration_date = note.expiration_date;
    event.date_sent = note.date_sent;
    emit(event);
}
