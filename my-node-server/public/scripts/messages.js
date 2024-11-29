$(document).ready(function(){

    $Main_Pic = $("#main_pic");
    $section_main = $(".section");

    $senders = $(".sender");

    $full_name = $("#full_name");
    $email = $("#email");
    $phone = $("#phone");
    $company = $("#company");
    $state = $("#state");
    
    $person_selected = $("#person_selected");

    $sidebar = $("#sidebar");

    senders = new Map();

    class Sender{
        constructor(id){
            this.SenderID = id;
            this.Name;
            this.Email;
            this.Company;
            this.Number;
            this.State;
            this.messages = [];
            this.Message_Counter = 0;
        }

        AddMessage(message){
            this.messages[this.Message_Counter] = message;
            this.Message_Counter++;
        }
    }

    class Message{
        constructor(content, date){
            this.Content = content;
            this.Date = date;
        }
    }


    //Get_Senders();

    function Populate_Messages(sender)
    {

        $(".message").remove();

        messages = sender.messages;

        for(var i = 0; i < messages.length; i++)
        {

            $full_name.text(sender.Name);
            $email.text(sender.Email);
            $phone.text(sender.Number);
            $state.text(sender.State);
            $company.text(sender.Company);

            $new_message = $("<div class='message'></div>");
            $new_message.html(messages[i].Content + "<br>");

            $date = $("<a></a>");
            $date.text(messages[i].Date);

            $date.appendTo($new_message);

            $new_message.appendTo($person_selected);

        }

    }

    function Get_Senders(){

        $.get("/senders/", function(data, status){
                        
            if(status == "success"){

                for(var i = 0; i < data.length; i++)
                {
                    sender = new Sender(data[i].id);
                    sender.Name = data[i].name;
                    sender.Email = data[i].email;
                    sender.Company = data[i].company_name;
                    sender.Number = data[i].number;
                    sender.State = data[i].state_name;
                    senders.set(data[i].id, sender);

                    Get_Messages(sender.SenderID);

                }

                Populate_Senders();

            }
            
        }).fail(function(jqXHR, textStatus, errorThrown){
        
            if(jqXHR.status == 420) {

                window.alert("You have no messages");
            
            }	
        
        });

    }

    function Get_Messages(sender_id){

        $.get("/message/" + sender_id, function(data, status){
                        
            if(status == "success"){

                for(var i = 0; i < data.length; i++)
                {
                    new_message = new Message(data[i].content, data[i].date);
                    senders.get(data[i].sender_id).AddMessage(new_message);
                }

                first_id = parseInt( $senders.first().attr('id') );
                first_sender = senders.get( first_id );

                Populate_Messages( first_sender );

            }
            
        }).fail(function(jqXHR, textStatus, errorThrown){
        
            if(jqXHR.status == 420) {

                window.alert("You have no messages");
            
            }	
        
        });

    }
    
    function Populate_Senders()
    {
        for (const sender of senders.values()) {

            $new_sender = $("<p class='sender'></p>");
            $new_sender.text(sender.Name);
            $new_sender.attr("id", sender.SenderID);

            $new_sender.appendTo($sidebar);
        }

        SetSenderEvents();
    }
    
    function SetSenderEvents(){

        $senders = $(".sender");

        $senders.on("mouseenter", function(){

            $(this).animate({
    
                backgroundColor: "rgba(37, 43, 60, 1)",
            });
        });
    
        $senders.on("mouseleave", function(){
    
            $(this).animate({
    
                backgroundColor: "rgba(22, 25, 35, 1)",
            });
        });

        $senders.on("click", function(){

            //get all of the messages from person in order from earliest to latest

            Populate_Messages( senders.get( parseInt( $(this).attr('id') ) ) );
    
        });

    }

});